import { MEDS, WAIT_TARGET, MIN } from './constants.js';

/** Error de regla de negocio: su mensaje se muestra tal cual al usuario. */
export class DomainError extends Error {}

/* ---------- Máquina de estados del turno ---------- */

export const TRANSITIONS = {
  EN_ESPERA_TRIAJE: ['LLAMADO_TRIAJE', 'CANCELADO'],
  LLAMADO_TRIAJE: ['LLAMADO_TRIAJE', 'EN_TRIAJE', 'CANCELADO'],
  EN_TRIAJE: ['EN_ESPERA_CONSULTA', 'EN_ESPERA_TRIAJE'],
  EN_ESPERA_CONSULTA: ['LLAMADO_CONSULTA', 'CANCELADO'],
  LLAMADO_CONSULTA: ['LLAMADO_CONSULTA', 'EN_CONSULTA', 'CANCELADO'],
  EN_CONSULTA: ['ATENDIDO', 'EN_ESPERA_CONSULTA'],
  ATENDIDO: [],
  CANCELADO: [],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(turn, to) {
  if (!canTransition(turn.state, to)) {
    throw new DomainError(`El turno ${turn.id} ya no está disponible para esta acción (estado actual: ${turn.state}). Actualice la lista.`);
  }
}

/* ---------- Triaje ---------- */

export function parsePA(pa) {
  const m = /^(\d{2,3})\/(\d{2,3})$/.exec(String(pa || '').trim());
  return m ? { sys: +m[1], dia: +m[2] } : null;
}

export function calcIMC(peso, talla) {
  if (!(peso > 0) || !(talla > 0)) return null;
  return Math.round((peso / (talla * talla)) * 100) / 100;
}

export function imcCategory(imc) {
  if (imc == null) return null;
  if (imc < 18.5) return ['Bajo peso', 'warn'];
  if (imc < 25) return ['Normal', 'ok'];
  if (imc < 30) return ['Sobrepeso', 'warn'];
  return ['Obesidad', 'crit'];
}

/**
 * Estado de cada signo vital frente a los umbrales: 'crit' | 'warn' | 'ok' | null (sin dato).
 * Es la única fuente de verdad: la usan la prioridad, el formulario y la ficha del médico.
 */
export function vitalStatus(v, T) {
  const pa = parsePA(v.pa);
  const has = (x) => x !== '' && x != null && !Number.isNaN(+x) && +x > 0;
  const s = {};
  s.spo2 = !has(v.spo2) ? null : v.spo2 < T.spo2 ? 'crit' : v.spo2 <= T.spo2A ? 'warn' : 'ok';
  s.fc = !has(v.fc) ? null : v.fc > T.fcHi || v.fc < 40 ? 'crit' : v.fc > T.fcA ? 'warn' : 'ok';
  s.pa = !pa ? null : pa.sys < T.pasLo ? 'crit' : pa.sys >= T.pasA ? 'warn' : 'ok';
  s.fr = !has(v.fr) ? null : v.fr > T.frHi || v.fr < 8 ? 'crit' : v.fr >= T.frA ? 'warn' : 'ok';
  s.t = !has(v.t) ? null : v.t >= T.tmp ? 'crit' : v.t >= T.tmpA ? 'warn' : 'ok';
  return s;
}

export function evalTriage(v, T) {
  const s = vitalStatus(v, T);
  const pa = parsePA(v.pa);
  const text = {
    spo2: `SpO₂ ${v.spo2} %`,
    fc: `FC ${v.fc} lpm`,
    pa: pa ? `PAS ${pa.sys} mmHg` : '',
    fr: `FR ${v.fr} rpm`,
    t: `Temperatura ${v.t} °C`,
  };
  const c = Object.keys(s).filter((k) => s[k] === 'crit').map((k) => text[k]);
  const w = Object.keys(s).filter((k) => s[k] === 'warn').map((k) => text[k]);
  return {
    prio: c.length ? 'CRITICA' : w.length ? 'PRIORITARIA' : 'NORMAL',
    c,
    w,
    status: s,
    imc: calcIMC(+v.peso, +v.talla),
  };
}

export function validateVitals(v) {
  const errs = {};
  const range = (k, lo, hi, label) => {
    const n = +v[k];
    if (v[k] === '' || v[k] == null) errs[k] = 'Obligatorio';
    else if (Number.isNaN(n) || n < lo || n > hi) errs[k] = `${label} entre ${lo} y ${hi}`;
  };
  const pa = parsePA(v.pa);
  if (!v.pa) errs.pa = 'Obligatorio';
  else if (!pa) errs.pa = 'Formato 120/80';
  else if (pa.dia >= pa.sys) errs.pa = 'La diastólica debe ser menor que la sistólica';
  range('fc', 20, 250, 'FC');
  range('fr', 4, 80, 'FR');
  range('t', 30, 45, 'Temp.');
  range('spo2', 50, 100, 'SpO₂');
  range('peso', 1, 350, 'Peso');
  range('talla', 0.4, 2.4, 'Talla (m)');
  if (!String(v.motivo || '').trim()) errs.motivo = 'Describa el motivo de consulta';
  return errs;
}

/* ---------- Umbrales ---------- */

/** Los umbrales de alerta deben estar "antes" de los críticos, si no la prioridad sería incoherente. */
export function validateThresholds(T) {
  const e = [];
  if (!(T.spo2A > T.spo2)) e.push('SpO₂: el valor de alerta debe ser mayor que el crítico.');
  if (!(T.tmpA < T.tmp)) e.push('Temperatura: el valor de alerta debe ser menor que el crítico.');
  if (!(T.pasA > T.pasLo)) e.push('PAS: el valor de alerta (alta) debe ser mayor que el crítico (baja).');
  if (!(T.fcA < T.fcHi)) e.push('FC: el valor de alerta debe ser menor que el crítico.');
  if (!(T.frA < T.frHi)) e.push('FR: el valor de alerta debe ser menor que el crítico.');
  return e;
}

/* ---------- Colas ---------- */

const RANK = { CRITICA: 0, PRIORITARIA: 1, NORMAL: 2 };
export const byArrival = (a, b) => a.t0 - b.t0;
export const byPriority = (a, b) => (RANK[a.prio] ?? 3) - (RANK[b.prio] ?? 3) || a.t0 - b.t0;

/** Minutos de espera desde la última etapa y si supera el tiempo objetivo. */
export function waitInfo(turn, now) {
  const since = turn.tTriSave || turn.t0;
  const min = Math.max(0, Math.floor((now - since) / MIN));
  const target = turn.prio ? WAIT_TARGET[turn.prio] : WAIT_TARGET.SIN_TRIAJE;
  return { min, target, late: min > target };
}

/* ---------- Receta ---------- */

export const normalize = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Devuelve las alergias del paciente que chocan con los medicamentos indicados. */
export function allergyConflicts(allergyText, medNames) {
  const alg = normalize(allergyText);
  if (!alg.trim()) return [];
  const out = [];
  for (const name of medNames) {
    const nm = normalize(name);
    if (!nm) continue;
    const cat = MEDS.find((m) => normalize(m.n) === nm) || MEDS.find((m) => nm.startsWith(normalize(m.n).split(' ')[0]));
    const keys = cat ? cat.g : [nm.split(' ')[0]];
    const hit = keys.find((k) => k && alg.includes(k));
    if (hit) out.push({ med: name, motivo: hit });
  }
  return out;
}

export function validatePrescription(meds) {
  const errs = [];
  meds.forEach((m, i) => {
    if (!m.n.trim()) return;
    if (!m.dosis.trim() || !m.frec.trim()) errs.push(`Medicamento ${i + 1}: indique dosis y frecuencia.`);
    if (!(+m.dias >= 1 && +m.dias <= 90)) errs.push(`Medicamento ${i + 1}: la duración debe estar entre 1 y 90 días.`);
  });
  return errs;
}
