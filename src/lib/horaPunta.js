/**
 * Hora punta: muchos pacientes llegan en una hora y el centro los atiende con las MISMAS acciones de dominio que
 * usan las estaciones (store/actions.js), minuto a minuto, sobre una copia de prueba de los datos. Admisión genera
 * los turnos, Caja cobra a los no asegurados, un solo módulo de triaje atiende de uno en uno y cada médico llama
 * solo a sus citas cuando llega la hora. El resultado es una foto por minuto para reproducirla en el flujo en vivo.
 */
import { DomainError, byConsulta, byTriaje, turnKey } from './clinical.js';
import { CIE, MIN, SIS_EXONERADO } from './constants.js';
import { especialidadSugerida, sugerirCita } from './agenda.js';
import { applyChanges } from '../data/merge.js';
import { toFacts } from './analytics.js';
import { modeloEspera } from './ml.js';
import {
  assignCita, callTurn, createTurn, finishConsult, registerPayment, saveTriage, startConsult, startTriage,
} from '../store/actions.js';

/** Números pseudoaleatorios con semilla: la misma hora punta se repite igual en cada demostración. */
function azar(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.entre = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  return r;
}

/** Signos vitales según la gravedad que trae el paciente; la prioridad la calcula el sistema con los umbrales. */
const BASE = { pa: '118/76', fc: '78', fr: '16', t: '36.8', spo2: '98', peso: '66', talla: '1.62' };
const CASOS = {
  NORMAL: [
    ['Dolor de garganta y tos', {}, 'J06.9'], ['Control de presión', { pa: '132/84' }, 'I10'], ['Dolor lumbar', {}, 'M54.5'],
    ['Dolor de cabeza', {}, 'R51'], ['Acidez y dolor de estómago', {}, 'K29.7'], ['Control prenatal', { pa: '110/70' }, 'Z34.9'],
  ],
  PRIORITARIA: [['Fiebre alta y malestar', { t: '38.4', fc: '104' }, 'R50.9'], ['Diarrea con vómitos', { fc: '108' }, 'A09']],
  CRITICA: [['Falta de aire y fiebre', { spo2: '86', fr: '32', fc: '124', t: '38.9', pa: '150/95' }, 'J18.9']],
};

const ADMISION = ['a.admision', 'a.admision2'];
const CAJAS = ['c.caja', 'c.caja2'];
const ENFERMERA = 'e.triaje';

/**
 * Simula la hora punta. Devuelve { fotos, pacientes, resumen }: una foto por minuto con { now, db, eventos }.
 * `pacientes` llegan en `minutos` (más al comienzo, como en la mañana de un centro de salud).
 */
export function simularHoraPunta(base, reloj, { pacientes = 20, minutos = 60, seed = 11, maxMin = 360 } = {}) {
  const r = azar(seed);
  const userOf = (u) => base.users.find((x) => x.u === u);
  const candidatos = base.patients.filter((p) => ['ACTIVO', 'NO_ASEGURADO'].includes(p.sis));
  const elegidos = [...candidatos].sort(() => r() - 0.5).slice(0, pacientes);
  // Llegadas: más pacientes al inicio de la hora; una urgencia con signo de alarma hacia la mitad
  const llegadas = elegidos
    .map((p, i) => {
      const prio = r() < 0.09 ? 'CRITICA' : r() < 0.27 ? 'PRIORITARIA' : 'NORMAL';
      return { p, min: Math.min(minutos - 1, Math.floor(minutos * r() ** 1.5)), prio, urg: i === Math.floor(pacientes / 2) };
    })
    .map((x) => (x.urg ? { ...x, prio: 'CRITICA' } : x))
    .sort((a, b) => a.min - b.min);

  let db = base;
  const plan = new Map(); // dni → { prio, caso }
  const fin = new Map(); // id → minuto en que termina lo que se está haciendo (caja, triaje o consulta)
  const fotos = [];
  let errores = 0;
  const ejecutar = (u, area, now, accion, eventos, texto) => {
    try {
      const res = accion(db, { user: userOf(u), area, now, ip: '' });
      db = applyChanges(db, res.changes);
      if (texto) eventos.push(typeof texto === 'function' ? texto(res) : texto);
      return res;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      errores++;
      return null;
    }
  };
  const hoy = (now) => db.turns.filter((t) => t.t0 >= reloj && t.t0 <= now);
  const ocupada = { caja: new Map() };

  for (let m = 0; m <= maxMin; m++) {
    const now = reloj + m * MIN;
    const eventos = [];

    // Admisión: llegan los pacientes de este minuto
    for (const x of llegadas.filter((y) => y.min === m)) {
      const caso = CASOS[x.prio][r.entre(0, CASOS[x.prio].length - 1)];
      plan.set(x.p.dni, { prio: x.prio, caso });
      ejecutar(ADMISION[r.entre(0, 1)], undefined, now,
        (d, c) => createTurn(d, c, { dni: x.p.dni, form: { tel: x.p.tel }, sis: x.p.sis, urg: x.urg ? 'Dificultad para respirar' : null }), eventos,
        (res) => `${res.result.id} llega${x.urg ? ' con dificultad para respirar (urgencia)' : ''}${SIS_EXONERADO.includes(x.p.sis) || x.urg ? '' : ' y va a Caja'}`);
    }

    // Caja: dos cajeros cobran por orden de llegada (2 a 4 minutos por paciente)
    for (const u of CAJAS) {
      const actual = ocupada.caja.get(u);
      if (actual && fin.get(actual) <= m) {
        ejecutar(u, undefined, now, (d, c) => registerPayment(d, c, actual, { metodo: r() < 0.6 ? 'EFECTIVO' : 'TARJETA', recibido: 20 }), eventos, `${actual} paga en Caja`);
        ocupada.caja.delete(u);
      }
      if (!ocupada.caja.has(u)) {
        const enCaja = new Set(ocupada.caja.values());
        const sig = hoy(now).filter((t) => t.state === 'PENDIENTE_PAGO' && !enCaja.has(t.id)).sort((a, b) => a.t0 - b.t0)[0];
        if (sig) {
          ocupada.caja.set(u, sig.id);
          fin.set(sig.id, m + r.entre(2, 4));
        }
      }
    }

    // Triaje: un solo módulo; llamar, iniciar y registrar signos (4 a 6 minutos), y dar la cita
    const enTriaje = db.turns.find((t) => t.state === 'EN_TRIAJE');
    const llamado = db.turns.find((t) => t.state === 'LLAMADO_TRIAJE');
    if (enTriaje && fin.get(enTriaje.id) <= m) {
      const { caso } = plan.get(enTriaje.dni);
      const p = db.patients.find((x) => x.dni === enTriaje.dni);
      const res = ejecutar(ENFERMERA, undefined, now, (d, c) => saveTriage(d, c, enTriaje.id, { ...BASE, ...caso[1], motivo: caso[0] }, p.alg ?? ''), eventos,
        (x) => `${enTriaje.id} termina el triaje: prioridad ${x.result.prio.toLowerCase()}`);
      if (res) {
        const t = res.result;
        const s = sugerirCita(db, especialidadSugerida(p, t.tri, now), t.prio, now, turnKey(t));
        if (s) ejecutar(ENFERMERA, undefined, now, (d, c) => assignCita(d, c, t.id, s.cita), eventos);
      }
    } else if (llamado) {
      ejecutar(ENFERMERA, undefined, now, (d, c) => startTriage(d, c, llamado.id));
      fin.set(llamado.id, m + r.entre(4, 6));
    } else if (!enTriaje) {
      const sig = db.turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE').sort(byTriaje)[0];
      if (sig) ejecutar(ENFERMERA, undefined, now, (d, c) => callTurn(d, c, sig.id), eventos, `Triaje llama a ${sig.id}`);
    }

    // Consulta: cada médico llama a su siguiente paciente cuando llega la hora de la cita (8 a 15 minutos)
    const medicos = [...new Set(db.turns.filter((t) => t.cita && ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'].includes(t.state)).map((t) => t.cita.med))];
    for (const med of medicos) {
      const suyos = db.turns.filter((t) => t.cita?.med === med);
      const enCurso = suyos.find((t) => t.state === 'EN_CONSULTA');
      const llamadoMed = suyos.find((t) => t.state === 'LLAMADO_CONSULTA');
      if (enCurso) {
        if (fin.get(enCurso.id) <= m) {
          const { prio, caso } = plan.get(enCurso.dni) ?? { prio: 'NORMAL', caso: CASOS.NORMAL[0] };
          const critico = prio === 'CRITICA';
          ejecutar(med, enCurso.cita.area, now, (d, c) => finishConsult(d, c, enCurso.id, {
            notas: 'Atención de la hora punta (demostración).', dx: [[...CIE.find((c) => c[0] === caso[2]), 'D']], meds: [],
            dest: critico ? 'Derivación a hospital' : 'Alta', destx: critico ? 'Hospital Nacional (demo)' : '',
          }), eventos, `${enCurso.id} termina su consulta${critico ? ' y se deriva al hospital' : ''}`);
        }
      } else if (llamadoMed) {
        ejecutar(med, llamadoMed.cita.area, now, (d, c) => startConsult(d, c, llamadoMed.id));
        fin.set(llamadoMed.id, m + r.entre(8, 15));
      } else {
        const sig = suyos.filter((t) => t.state === 'EN_ESPERA_CONSULTA' && t.cita.at <= now).sort(byConsulta)[0];
        if (sig) ejecutar(med, sig.cita.area, now, (d, c) => callTurn(d, c, sig.id), eventos, `${sig.cita.area} llama a ${sig.id}`);
      }
    }

    fotos.push({ m, now, db, eventos });
    // Termina cuando ya llegaron todos y nadie sigue en el centro (los citados para otro día se van)
    const activos = hoy(now).filter((t) => !['ATENDIDO', 'CANCELADO', 'CITADO'].includes(t.state));
    if (m >= minutos && !activos.length) break;
  }
  return { fotos, llegadas: llegadas.length, errores, resumen: resumir(base, db, reloj, fotos.at(-1).now) };
}

/** Cifras de la hora punta y la espera real de cada paciente frente a la que estimaba el modelo de ML. */
function resumir(base, db, reloj, fin) {
  const hoy = db.turns.filter((t) => t.t0 >= reloj);
  const atendidos = hoy.filter((t) => t.state === 'ATENDIDO');
  // Espera del paciente como la aprende el modelo: pago, triaje y consulta, sin contar la hora de la cita
  const espera = (t) => ((t.tPago ?? t.t0) - t.t0 + (t.tTriCall - (t.tPago ?? t.t0)) + (t.tMedCall - t.tLlega)) / MIN;
  // El modelo se entrena con el historial anterior (no ve esta hora) y estima con lo que se sabía al llegar
  const historia = toFacts(base.turns, base.patients);
  const ml = modeloEspera(historia, reloj);
  const cargaHora = hoy.reduce((m, t) => m.set(new Date(t.t0).getHours(), (m.get(new Date(t.t0).getHours()) || 0) + 1), new Map());
  const comparados = ml
    ? atendidos.filter((t) => t.tLlega && t.tTriCall).map((t) => ({
      id: t.id, prio: t.prio, real: espera(t),
      ml: ml.predecir({ prio: t.prio, paga: t.pago?.metodo !== 'SIS', t0: t.t0 }, cargaHora.get(new Date(t.t0).getHours()) || 1),
    }))
    : [];
  const mae = comparados.length ? comparados.reduce((a, x) => a + Math.abs(x.ml - x.real), 0) / comparados.length : null;
  // Sesgo: positivo si el modelo estimó más espera de la que hubo; negativo si se quedó corto
  const sesgo = comparados.length ? comparados.reduce((a, x) => a + x.ml - x.real, 0) / comparados.length : null;
  return {
    llegaron: hoy.length,
    atendidos: atendidos.length,
    citadosOtroDia: hoy.filter((t) => t.state === 'CITADO').length,
    criticos: hoy.filter((t) => t.prio === 'CRITICA').length,
    esperaMedia: comparados.length ? comparados.reduce((a, x) => a + x.real, 0) / comparados.length : null,
    duracion: Math.round((fin - reloj) / MIN),
    comparados, mae, sesgo,
  };
}
