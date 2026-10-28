/**
 * Indicadores de gestión. Trabaja sobre «hechos» anónimos: un registro por turno, sin código de turno,
 * nombre ni DNI, con la llegada redondeada a la hora y la duración de cada etapa en minutos (así no se
 * pueden cruzar con la hora exacta de otros registros). En Supabase los entrega sgc_indicadores()
 * (solo Jefatura); en modo local se derivan con toFacts(). Toda la agregación vive aquí, para que
 * ambos modos muestren exactamente las mismas cifras.
 */
import { ABANDONO, AREAS, CIE, DAY, ESPECIALIDADES, GRUPOS_EDAD, MIN, PRIO, STAGES, WAIT_TARGET } from './constants.js';
import { ageAt, startOfDay } from './format.js';
import { minutesBetween } from './clinical.js';

const hourOf = (t) => {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
};

/** Hecho anónimo de un turno. Mismo formato que devuelve sgc_indicadores(). */
export function toFacts(turns, patients) {
  const byDni = new Map(patients.map((p) => [p.dni, p]));
  return turns.map((t) => {
    const p = byDni.get(t.dni);
    return {
      t0: hourOf(t.t0), state: t.state, prio: t.prio ?? null,
      dur: Object.fromEntries(STAGES.map((s) => [s.k, minutesBetween(t, s.from, s.to)])),
      area: t.consult?.area ?? (AREAS.includes(t.dest) ? t.dest : null), med: t.consult?.medico?.u ?? t.med ?? null,
      sexo: p?.sexo ?? null, edad: p ? ageAt(p.nac, t.t0) : null, sis: p?.sis ?? null,
      dx: t.consult ? t.consult.dx.map((d) => d[0]) : [], dest: t.consult?.dest ?? null,
      esp: t.cita?.esp ?? null, otroDia: t.cita ? startOfDay(t.cita.at) !== startOfDay(t.t0) : null,
      motivo: t.state === 'CANCELADO' ? t.cancel?.motivo ?? null : null,
    };
  });
}

export const RANGES = [
  { k: 'hoy', n: 'Hoy', days: 1 },
  { k: '7d', n: '7 días', days: 7 },
  { k: '14d', n: '14 días', days: 14 },
  { k: '28d', n: '4 semanas', days: 28 },
];

/**
 * Periodo actual y periodo de comparación. Ambos terminan a la misma hora relativa, así «hoy a las 10 h»
 * se compara con el mismo tramo del periodo anterior. «Hoy» se compara con el mismo día de la semana pasada.
 */
export function periodOf(rangeKey, now = Date.now()) {
  const r = RANGES.find((x) => x.k === rangeKey) || RANGES[1];
  const from = startOfDay(now) - (r.days - 1) * DAY;
  const shift = r.days === 1 ? 7 * DAY : r.days * DAY;
  return { range: r, from, to: now, prevFrom: from - shift, prevTo: now - shift };
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const defined = (xs) => xs.filter((x) => x != null);
/** Tiempo total (llegada → alta): suma de las cuatro etapas, si están todas. */
const totalMin = (f) => (STAGES.every((s) => f.dur[s.k] != null) ? STAGES.reduce((a, s) => a + f.dur[s.k], 0) : null);
const countBy = (xs, key) => xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) || 0) + 1), new Map());

export const grupoEdad = (edad) => (edad == null ? null : GRUPOS_EDAD.find(([, , lo, hi]) => edad >= lo && edad <= hi)?.[0]);

/** Espera para consulta dentro del tiempo objetivo de su prioridad. */
const onTarget = (f) => (f.dur.espMed == null ? null : f.dur.espMed <= WAIT_TARGET[f.prio]);

/** Filtra hechos por intervalo [from, to) y consultorio. */
export const slice = (facts, from, to, area) =>
  facts.filter((f) => f.t0 >= from && f.t0 < to && (!area || f.area === area));

/** Indicadores de un conjunto de hechos. */
export function summarize(facts) {
  const done = facts.filter((f) => f.state === 'ATENDIDO');
  const called = facts.filter((f) => f.dur.espMed != null && f.prio);
  const target = defined(called.map(onTarget));
  return {
    n: facts.length,
    atendidos: done.length,
    cancelados: facts.filter((f) => f.state === 'CANCELADO').length,
    abandono: facts.length ? facts.filter((f) => ABANDONO.includes(f.motivo)).length / facts.length : null,
    tiempoTotal: mean(defined(done.map(totalMin))),
    enObjetivo: target.length ? target.filter(Boolean).length / target.length : null,
    derivaciones: done.filter((f) => f.dest === 'Derivación a hospital').length,
    stages: STAGES.map((s) => ({ ...s, mean: mean(defined(facts.map((f) => f.dur[s.k]))) })),
  };
}

/** Serie por día (o por hora si el periodo es de un día) con la composición por prioridad. */
export function series(facts, from, to, byHour = false) {
  const buckets = [];
  if (byHour) {
    for (let h = 7; h <= 17; h++) buckets.push({ t: from + h * 60 * MIN, end: from + (h + 1) * 60 * MIN, label: `${h} h` });
  } else {
    for (let t = from; t < to; t += DAY) {
      const s = startOfDay(t + DAY / 2); // robusto ante cambios de horario
      if (new Date(s).getDay() === 0 && !facts.some((f) => f.t0 >= s && f.t0 < s + DAY)) continue; // domingo sin atención
      buckets.push({ t: s, end: s + DAY, label: null });
    }
  }
  return buckets.map((b) => {
    const fs = facts.filter((f) => f.t0 >= b.t && f.t0 < b.end);
    const s = summarize(fs);
    const prio = Object.fromEntries(Object.keys(PRIO).map((k) => [k, fs.filter((f) => f.prio === k && f.state !== 'CANCELADO').length]));
    return {
      ...b, ...prio, total: fs.length, atendidos: s.atendidos, cancelados: s.cancelados, abandono: s.abandono,
      tiempoTotal: s.tiempoTotal, enObjetivo: s.enObjetivo,
      ...Object.fromEntries(s.stages.filter((x) => x.wait).map((x) => [x.k, x.mean])),
    };
  });
}

/** Llegadas promedio por día de la semana (lun–sáb) y hora (7–16 h). */
export function heatmap(facts, from, to) {
  const hours = Array.from({ length: 10 }, (_, i) => 7 + i);
  const dows = [1, 2, 3, 4, 5, 6];
  const daysPerDow = new Map(dows.map((d) => [d, 0]));
  for (let t = from; t < to; t += DAY) {
    const d = new Date(t + DAY / 2).getDay();
    if (daysPerDow.has(d)) daysPerDow.set(d, daysPerDow.get(d) + 1);
  }
  const cells = dows.map((d) =>
    hours.map((h) => {
      const n = facts.filter((f) => new Date(f.t0).getDay() === d && new Date(f.t0).getHours() === h).length;
      const days = daysPerDow.get(d);
      return { dow: d, h, n, avg: days ? n / days : 0 };
    }),
  );
  return { hours, dows, cells, max: Math.max(0, ...cells.flat().map((c) => c.avg)) };
}

/** Horas de llegada que se prevén (las mismas del mapa de calor). */
export const HORAS_AFLUENCIA = Array.from({ length: 10 }, (_, i) => 7 + i);

/**
 * Afluencia prevista (RF-15) con la línea base del capítulo IV del informe: para cada hora, el promedio de
 * llegadas del mismo día de la semana en las `semanas` semanas anteriores. Devuelve los próximos `dias`
 * días de atención (desde hoy, sin domingos) con su franja de mayor afluencia: las horas vecinas a la de más
 * llegadas que tienen al menos el 80 % de ese máximo.
 *
 * La precisión se mide igual que se usaría: se prevé cada día de la última semana con las semanas anteriores
 * a él y se compara con lo que llegó (error absoluto medio por hora).
 */
export function afluenciaPrevista(facts, now, { semanas = 4, dias = 6 } = {}) {
  const porDia = new Map();
  for (const f of facts) {
    const i = new Date(f.t0).getHours() - HORAS_AFLUENCIA[0];
    if (i < 0 || i >= HORAS_AFLUENCIA.length) continue;
    const d = startOfDay(f.t0);
    if (!porDia.has(d)) porDia.set(d, HORAS_AFLUENCIA.map(() => 0));
    porDia.get(d)[i]++;
  }
  if (!porDia.size) return null;
  const primero = Math.min(...porDia.keys());
  const vacio = HORAS_AFLUENCIA.map(() => 0);
  const prever = (d) => {
    const prev = [];
    for (let k = 1; k <= semanas; k++) {
      const p = startOfDay(d - k * 7 * DAY + DAY / 2);
      if (p >= primero) prev.push(porDia.get(p) || vacio);
    }
    return prev.length ? HORAS_AFLUENCIA.map((_, i) => mean(prev.map((c) => c[i]))) : null;
  };
  const franja = (pred) => {
    const max = Math.max(...pred);
    const top = pred.indexOf(max);
    let lo = top;
    let hi = top;
    while (lo > 0 && pred[lo - 1] >= 0.8 * max) lo--;
    while (hi < pred.length - 1 && pred[hi + 1] >= 0.8 * max) hi++;
    return { ini: HORAS_AFLUENCIA[lo], fin: HORAS_AFLUENCIA[hi] + 1, porHora: max };
  };

  const hoy = startOfDay(now);
  const proximos = [];
  for (let k = 0; proximos.length < dias && k < dias + 2; k++) {
    const d = startOfDay(hoy + k * DAY + DAY / 2);
    if (new Date(d).getDay() === 0) continue; // domingo: el centro no atiende
    const pred = prever(d);
    if (pred) proximos.push({ t: d, pred, total: pred.reduce((a, b) => a + b, 0), franja: franja(pred) });
  }

  const errores = [];
  const reales = [];
  let evaluados = 0;
  for (let k = 1; k <= 7; k++) {
    const d = startOfDay(hoy - k * DAY + DAY / 2);
    if (new Date(d).getDay() === 0 || d < primero) continue;
    const pred = prever(d);
    if (!pred) continue;
    const real = porDia.get(d) || vacio;
    pred.forEach((v, i) => errores.push(Math.abs(v - real[i])));
    reales.push(...real);
    evaluados++;
  }
  const pico = proximos.reduce((a, x) => (x.franja.porHora > (a?.franja.porHora ?? -1) ? x : a), null);
  return { semanas, dias: proximos, pico, mae: mean(errores), mediaHora: mean(reales), evaluados };
}

const CIE_DESC = new Map(CIE);

/** Diagnósticos más frecuentes (morbilidad). */
export function topDx(facts, limit = 8) {
  const counts = countBy(facts.flatMap((f) => f.dx), (x) => x);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([code, n]) => ({ code, n, desc: CIE_DESC.get(code) || code }));
}

export function destinos(facts) {
  const done = facts.filter((f) => f.dest);
  return ['Alta', 'Reposo médico', 'Derivación a hospital'].map((d) => ({ k: d, n: done.filter((f) => f.dest === d).length, total: done.length }));
}

export function perfil(facts) {
  const withP = facts.filter((f) => f.edad != null);
  const g = countBy(withP, (f) => grupoEdad(f.edad));
  return {
    total: withP.length,
    grupos: GRUPOS_EDAD.map(([k, n, lo, hi]) => ({ k, n, range: hi > 120 ? `${lo}+ años` : `${lo}–${hi} años`, count: g.get(k) || 0 })),
    mujeres: withP.filter((f) => f.sexo === 'F').length,
    sis: withP.filter((f) => f.sis === 'ACTIVO').length,
  };
}

/** Cumplimiento del tiempo objetivo de espera por prioridad. */
export function cumplimiento(facts) {
  return Object.keys(PRIO).map((prio) => {
    const vals = defined(facts.filter((f) => f.prio === prio).map(onTarget));
    return { prio, target: WAIT_TARGET[prio], n: vals.length, ok: vals.filter(Boolean).length, rate: vals.length ? vals.filter(Boolean).length / vals.length : null };
  });
}

/**
 * Citas por especialidad: cuántas se dieron, cuántas fueron para otro día (la especialidad no atendía o
 * no tenía cupo ese día) y cuántas terminaron en atención.
 */
export function porEspecialidad(facts) {
  return ESPECIALIDADES.map((e) => {
    const fs = facts.filter((f) => f.esp === e.k);
    return { k: e.k, n: e.n, rama: e.rama, citas: fs.length, otroDia: fs.filter((f) => f.otroDia).length, atendidos: fs.filter((f) => f.state === 'ATENDIDO').length };
  });
}

/** Atenciones y duración media de consulta por consultorio. */
export function porConsultorio(facts) {
  const done = facts.filter((f) => f.state === 'ATENDIDO');
  return AREAS.map((area) => {
    const fs = done.filter((f) => f.area === area);
    return { area, n: fs.length, consulta: mean(defined(fs.map((f) => f.dur.med))), med: countBy(fs, (f) => f.med) };
  });
}

/** Variación relativa entre dos valores (null si no hay base de comparación). */
export const delta = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : (cur - prev) / prev);

/** CSV con separador «;» (Excel en español) y BOM para que respete las tildes. */
export function toCSV(columns, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => cell(c[1])), ...rows.map((r) => columns.map((c) => cell(typeof c[2] === 'function' ? c[2](r) : r[c[0]])))]
    .map((line) => line.join(';')).join('\r\n');
}
