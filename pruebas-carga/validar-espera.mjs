// Validación de la espera aproximada (RF-14) con datos simulados.
//
// Simula jornadas con los supuestos del Anexo E del informe (sección 9): llegadas con pico entre 8:00 y 10:00,
// un módulo de triaje por orden de llegada (media 7 min), dos consultorios que atienden por prioridad
// (media 14,5 min) y prioridades Normal 68 %, Prioritaria 23 % y Crítica 9 %. Cada vez que un paciente entra a
// una cola se guarda la espera que mostraría el sistema (src/lib/espera.js, la misma regla de sgc_sala()) y,
// cuando lo llaman, la espera real. Igual que en el Anexo E, los primeros 14 días sirven de referencia (la
// «base» es su espera promedio) y los últimos 4 días se evalúan.
//
// Uso: TZ=America/Lima node pruebas-carga/validar-espera.mjs
// Los datos son simulados: validan el cálculo, no el desempeño en un establecimiento real.
import { writeFileSync } from 'node:fs';
import { estimarEsperas, rangoEspera } from '../src/lib/espera.js';
import { byArrival, byConsulta, turnKey } from '../src/lib/clinical.js';
import { MIN } from '../src/lib/constants.js';

const DIAS = 18;
const DIAS_BASE = 14;
const PASO = 0.5; // minutos
const MEDICOS = ['m.consulta', 'm.consulta2'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(2026);
const between = (a, b) => a + r() * (b - a);
const weighted = (pairs) => {
  let x = r() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((x -= w) < 0) return v;
  return pairs.at(-1)[0];
};
// Llegadas por hora (7 a 15 h), con pico entre 8:00 y 10:00
const HORAS = [[7, 9], [8, 17], [9, 16], [10, 11], [11, 8], [12, 6], [13, 5], [14, 4], [15, 3]];

const registros = [];

function jornada(dia) {
  const fecha = new Date(2026, 8, 14 + dia + Math.floor(dia / 6)); // lunes a sábado desde el 14-sep-2026
  const t7 = fecha.setHours(7, 0, 0, 0);
  const n = Math.round(between(52, 68));
  const turns = Array.from({ length: n }, () => {
    const [h] = [weighted(HORAS.map(([hh, w]) => [hh, w]))];
    const t0 = t7 + ((h - 7) * 60 + between(0, 59)) * MIN;
    const sis = r() < 0.8;
    return {
      t0, state: 'PENDIENTE_PAGO',
      sim: {
        pago: t0 + (sis ? 0 : between(2, 9)) * MIN,
        tri: between(4, 10),
        prio: weighted([['NORMAL', 68], ['PRIORITARIA', 23], ['CRITICA', 9]]),
        cita: between(1, 5),
        med: between(8, 21),
      },
    };
  }).sort(byArrival).map((t, i) => ({ ...t, id: `TR-${String(i + 1).padStart(3, '0')}` }));

  const estimar = (t, etapa, now) => {
    t.sim.est = { etapa, now, min: estimarEsperas(turns, now).get(turnKey(t)) };
  };
  const llamar = (t, now, real) => registros.push({ dia, etapa: t.sim.est.etapa, prio: t.prio ?? null, est: t.sim.est.min, real });

  for (let now = t7; turns.some((t) => !['ATENDIDO'].includes(t.state)); now += PASO * MIN) {
    for (const t of turns) {
      if (t.state === 'PENDIENTE_PAGO' && t.sim.pago <= now) {
        Object.assign(t, { state: 'EN_ESPERA_TRIAJE', tPago: now });
        estimar(t, 'triaje', now);
      } else if (t.state === 'EN_TRIAJE' && t.tTriCall + t.sim.tri * MIN <= now) {
        Object.assign(t, { state: 'PENDIENTE_CITA', tTriSave: now, prio: t.sim.prio });
      } else if (t.state === 'PENDIENTE_CITA' && t.tTriSave + t.sim.cita * MIN <= now) {
        // La cita es con el médico que tiene menos pacientes por delante, a la hora de llegada
        const carga = (u) => turns.filter((x) => ['EN_ESPERA_CONSULTA', 'EN_CONSULTA'].includes(x.state) && x.cita.med === u).length;
        const med = [...MEDICOS].sort((a, b) => carga(a) - carga(b))[0];
        Object.assign(t, { state: 'EN_ESPERA_CONSULTA', tCita: now, tLlega: now, cita: { esp: 'MG', med, area: '', at: now, sobre: false } });
        estimar(t, 'consulta', now);
      } else if (t.state === 'EN_CONSULTA' && t.tMedCall + t.sim.med * MIN <= now) {
        Object.assign(t, { state: 'ATENDIDO', tEnd: now, consult: { medico: { u: t.cita.med } } });
      }
    }
    // Triaje: un módulo, por orden de llegada
    if (!turns.some((t) => t.state === 'EN_TRIAJE')) {
      const sig = turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE').sort(byArrival)[0];
      if (sig) {
        Object.assign(sig, { state: 'EN_TRIAJE', tTriCall: now });
        llamar(sig, now, (now - sig.tPago) / MIN);
      }
    }
    // Consulta: cada médico llama al siguiente de su cola, por prioridad y hora de llegada
    for (const u of MEDICOS) {
      if (turns.some((t) => t.state === 'EN_CONSULTA' && t.cita.med === u)) continue;
      const sig = turns.filter((t) => t.state === 'EN_ESPERA_CONSULTA' && t.cita.med === u).sort(byConsulta)[0];
      if (sig) {
        Object.assign(sig, { state: 'EN_CONSULTA', tMedCall: now });
        llamar(sig, now, (now - sig.tLlega) / MIN);
      }
    }
  }
  return turns.length;
}

let turnos = 0;
for (let d = 0; d < DIAS; d++) turnos += jornada(d);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r2 = (x) => Math.round(x * 100) / 100;
function metricas(rows, pred) {
  const err = rows.map((x) => pred(x) - x.real);
  const m = mean(rows.map((x) => x.real));
  const sse = err.reduce((a, e) => a + e * e, 0);
  const sst = rows.reduce((a, x) => a + (x.real - m) ** 2, 0);
  return { n: rows.length, mae: r2(mean(err.map(Math.abs))), rmse: r2(Math.sqrt(sse / rows.length)), r2: r2(1 - sse / sst), sesgo: r2(mean(err)) };
}
const enRango = (x) => {
  if (x.est < 5) return x.real < 5;
  const lo = Math.floor(x.est / 5) * 5;
  return x.real >= lo && x.real < lo + 5;
};

const resultado = { fecha: new Date().toISOString(), supuestos: 'Anexo E, sección 9 del informe', dias: DIAS, diasBase: DIAS_BASE, turnos, etapas: {} };
for (const etapa of ['triaje', 'consulta']) {
  const base = registros.filter((x) => x.etapa === etapa && x.dia < DIAS_BASE);
  const prueba = registros.filter((x) => x.etapa === etapa && x.dia >= DIAS_BASE);
  const promedio = mean(base.map((x) => x.real));
  resultado.etapas[etapa] = {
    esperaRealMedia: r2(mean(prueba.map((x) => x.real))),
    base: metricas(prueba, () => promedio),
    rf14: metricas(prueba, (x) => x.est),
    dentroDelRango: r2(prueba.filter(enRango).length / prueba.length),
    errorHasta5min: r2(prueba.filter((x) => Math.abs(x.est - x.real) <= 5).length / prueba.length),
    porPrioridad: etapa === 'consulta'
      ? Object.fromEntries(['CRITICA', 'PRIORITARIA', 'NORMAL'].map((p) => [p, metricas(prueba.filter((x) => x.prio === p), (x) => x.est)]))
      : undefined,
    ejemplo: prueba.slice(0, 5).map((x) => ({ mostrado: rangoEspera(x.est), est: x.est, real: r2(x.real) })),
  };
}

writeFileSync(new URL('./resultados/espera-simulada.json', import.meta.url), JSON.stringify(resultado, null, 2) + '\n');
console.log(`${turnos} turnos simulados en ${DIAS} días; evaluación en los últimos ${DIAS - DIAS_BASE} días\n`);
console.log('Etapa     Modelo           MAE   RMSE    R²   Sesgo  En el rango  |error| ≤ 5 min');
for (const [k, e] of Object.entries(resultado.etapas)) {
  console.log(`${k.padEnd(9)} Base (promedio) ${String(e.base.mae).padStart(5)} ${String(e.base.rmse).padStart(6)} ${String(e.base.r2).padStart(5)} ${String(e.base.sesgo).padStart(6)}`);
  console.log(`${''.padEnd(9)} RF-14           ${String(e.rf14.mae).padStart(5)} ${String(e.rf14.rmse).padStart(6)} ${String(e.rf14.r2).padStart(5)} ${String(e.rf14.sesgo).padStart(6)}  ${String(Math.round(e.dentroDelRango * 100)).padStart(9)} %  ${String(Math.round(e.errorHasta5min * 100)).padStart(13)} %`);
}
console.log('\nResultado guardado en pruebas-carga/resultados/espera-simulada.json');
