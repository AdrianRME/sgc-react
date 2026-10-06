/**
 * Historia de demostración: semanas de atención de un centro de salud de primer nivel, generada de
 * forma determinista (misma semilla → mismos datos). Solo usa datos ficticios.
 *
 * Reglas que siguen los datos, para que el tablero cuente algo creíble:
 * - Lunes a sábado (el sábado solo por la mañana); la demanda se concentra entre 7 y 10 h.
 * - La prioridad NO se inventa: se calcula con evalTriage sobre los signos generados, igual que en triaje.
 * - La espera de consulta depende de la prioridad y de la carga de esa hora; mejora semana a semana.
 * - La receta respeta las alergias registradas del paciente.
 */
import { allergyConflicts, evalTriage } from './clinical.js';
import { CANCEL, CIE, DAY, MIN, TH_DEFAULT, AREAS } from './constants.js';
import { startOfDay } from './format.js';

export const DOCTORS = {
  'Consultorio 1': { u: 'm.consulta', n: 'Dra. Elena Ríos (demo)', col: 'CMP-00000' },
  'Consultorio 2': { u: 'm.consulta2', n: 'Dr. Luis Paz (demo)', col: 'CMP-00001' },
};
export const STAFF = ['a.admision', 'e.triaje', 'm.consulta', 'm.consulta2'];

/** Generador pseudoaleatorio reproducible (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    between: (lo, hi, dec = 0) => +(lo + next() * (hi - lo)).toFixed(dec),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
  };
  return r;
}

const NOMBRES_F = ['Rosa', 'María', 'Carmen', 'Julia', 'Elena', 'Sofía', 'Valeria', 'Camila', 'Milagros', 'Gladys', 'Norma', 'Flor',
  'Luz', 'Yolanda', 'Patricia', 'Karina', 'Daniela', 'Fiorella', 'Ximena', 'Mariela', 'Noemí', 'Isabel', 'Rocío', 'Maribel'];
const NOMBRES_M = ['José', 'Juan', 'Carlos', 'Jorge', 'Miguel', 'Víctor', 'César', 'Raúl', 'Santiago', 'Alonso', 'Renzo', 'Edwin',
  'Wilmer', 'Hugo', 'Walter', 'Fernando', 'Óscar', 'Iván', 'Joel', 'Gustavo', 'Rolando', 'Teodoro', 'Abel', 'Nilton'];
const APELLIDOS = ['Quispe', 'Mamani', 'Huamán', 'Flores', 'Rojas', 'Ramos', 'Torres', 'Chávez', 'Vargas', 'Castillo', 'Mendoza',
  'Espinoza', 'Gutiérrez', 'Condori', 'Sánchez', 'Díaz', 'Cruz', 'Salazar', 'Ccori', 'Paucar', 'Ticona', 'Villanueva', 'Huanca',
  'Palomino', 'Poma', 'Yupanqui', 'Soto', 'Medina', 'Aguilar', 'Nina'];

export const med = (n, dosis, frec, dias) => ({ n, dosis, frec, dias, cant: '' });
const PARACETAMOL = med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3);

/**
 * Perfiles clínicos frecuentes en primer nivel: motivo, diagnósticos, examen, receta y cómo alteran
 * los signos. `ages` limita el perfil a ciertas edades; `chronic` lo liga a un antecedente.
 */
const PROFILES = [
  { w: 26, motivo: ['Dolor de garganta y tos', 'Congestión nasal y malestar general', 'Tos y fiebre de 2 días'],
    dx: ['J00', 'J06.9', 'J10.1'], notas: 'Faringe congestiva, sin exudado. Murmullo vesicular conservado.',
    meds: [PARACETAMOL, med('Loratadina 10 mg', '1 tableta', 'cada 24 h', 5)], fever: 0.45, hyper: 0.04 },
  { w: 8, motivo: ['Tos persistente con flema'], dx: ['J20.9'], notas: 'Roncantes dispersos en ambos campos pulmonares.',
    meds: [med('Salbutamol inhalador', '2 puff', 'cada 6 h', 5), PARACETAMOL], fever: 0.2, resp: 0.4 },
  { w: 4, motivo: ['Fiebre alta y dificultad para respirar'], dx: ['J18.9'], notas: 'Crepitantes en base derecha. Se solicita radiografía de tórax.',
    meds: [med('Amoxicilina 500 mg', '1 cápsula', 'cada 8 h', 7), PARACETAMOL], fever: 0.8, severe: 0.7 },
  { w: 4, motivo: ['Crisis de asma', 'Silbido en el pecho y falta de aire'], dx: ['J45.9'], notas: 'Sibilancias espiratorias difusas.',
    meds: [med('Salbutamol inhalador', '2 puff', 'cada 4 h', 5)], resp: 0.8, spo2: 0.4 },
  { w: 8, motivo: ['Dolor abdominal y acidez'], dx: ['K29.7'], notas: 'Dolor a la palpación en epigastrio, sin signos de alarma.',
    meds: [med('Omeprazol 20 mg', '1 cápsula', 'cada 24 h', 14)], ages: [12, 99] },
  { w: 7, motivo: ['Diarrea y vómitos', 'Deposiciones líquidas desde ayer'], dx: ['A09'], notas: 'Mucosas semihúmedas, abdomen blando y depresible.',
    meds: [med('Suero de rehidratación oral', '1 sobre', 'según pérdidas', 2)], fever: 0.25 },
  { w: 5, motivo: ['Ardor al orinar'], dx: ['N39.0'], notas: 'Disuria de 2 días. Puño percusión lumbar negativa.',
    meds: [med('Nitrofurantoína 100 mg', '1 cápsula', 'cada 12 h', 5)], ages: [15, 99] },
  { w: 6, motivo: ['Dolor de cabeza intenso'], dx: ['R51'], notas: 'Examen neurológico sin alteraciones.',
    meds: [PARACETAMOL], ages: [10, 99], hta: 0.2 },
  { w: 6, motivo: ['Dolor lumbar'], dx: ['M54.5'], notas: 'Contractura paravertebral lumbar, Lasègue negativo.',
    meds: [med('Naproxeno 550 mg', '1 tableta', 'cada 12 h', 5)], ages: [18, 99] },
  { w: 3, motivo: ['Control de presión arterial'], dx: ['I10'], notas: 'Asintomático, adherente al tratamiento.',
    meds: [med('Enalapril 10 mg', '1 tableta', 'cada 12 h', 30)], chronic: 'Hipertensión arterial', hta: 0.9 },
  { w: 3, motivo: ['Control de glucosa'], dx: ['E11.9'], notas: 'Glucosa capilar elevada. Se refuerzan las indicaciones de dieta.',
    meds: [med('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)], chronic: 'Diabetes mellitus tipo 2' },
  { w: 5, motivo: ['Fiebre sin causa aparente'], dx: ['R50.9', 'B34.9'], notas: 'Sin foco evidente al examen. Control en 48 horas.',
    meds: [PARACETAMOL], fever: 0.9, hyper: 0.12 },
];

/** Alternativas cuando la receta del perfil choca con una alergia registrada. */
const SAFE_SWAP = {
  'Amoxicilina 500 mg': med('Azitromicina 500 mg', '1 tableta', 'cada 24 h', 3),
  'Naproxeno 550 mg': PARACETAMOL,
};

const cie = (code) => CIE.find((c) => c[0] === code);

/** Llegadas por hora (7–15 h): la mayoría llega temprano para alcanzar turno. */
const HOUR_WEIGHTS = [[7, 16], [8, 20], [9, 17], [10, 13], [11, 10], [12, 7], [13, 6], [14, 6], [15, 5]];
const BASE_BY_DOW = [0, 24, 21, 20, 21, 23, 12]; // domingo cerrado

function vitalsFor(r, profile, patient, ageYears) {
  const child = ageYears < 12;
  const adult = ageYears >= 18;
  const v = {
    pa: `${r.between(adult ? 105 : 92, adult ? 132 : 115)}/${r.between(62, 84)}`,
    fc: r.between(child ? 80 : 62, child ? 104 : 92),
    fr: r.between(child ? 18 : 14, child ? 23 : 20),
    t: r.between(36.1, 37.3, 1),
    spo2: r.between(95, 99),
  };
  if (child) {
    v.talla = +(0.72 + ageYears * 0.058 + r.between(-0.04, 0.04, 2)).toFixed(2);
    v.peso = +(8 + ageYears * 2.7 + r.between(-2, 3, 1)).toFixed(1);
  } else {
    const f = patient.sexo === 'F';
    v.talla = r.between(f ? 1.47 : 1.57, f ? 1.66 : 1.79, 2);
    v.peso = r.between(f ? 49 : 58, f ? 82 : 94, 1);
  }
  if (r.chance(profile.fever || 0)) v.t = r.between(37.8, 39.7, 1);
  if (r.chance(profile.hyper || 0)) v.t = r.between(40, 40.6, 1);
  if (r.chance(profile.severe || 0)) {
    v.spo2 = r.between(85, 92);
    v.fc = r.between(100, 136);
    v.fr = r.between(22, 32);
  }
  if (r.chance(profile.resp || 0)) v.fr = Math.max(v.fr, r.between(21, 29));
  if (r.chance(profile.spo2 || 0)) v.spo2 = Math.min(v.spo2, r.between(88, 94));
  if (adult && r.chance(profile.hta || 0)) v.pa = `${r.between(138, 186)}/${r.between(86, 108)}`;
  return v;
}

/** Destino del paciente según la gravedad del triaje. */
const DEST_BY_PRIO = {
  NORMAL: [['Alta', 91], ['Reposo médico', 9]],
  PRIORITARIA: [['Alta', 78], ['Reposo médico', 18], ['Derivación a hospital', 4]],
  CRITICA: [['Alta', 25], ['Reposo médico', 25], ['Derivación a hospital', 50]],
};

/**
 * Genera `days` días de atenciones previos a `now` y la mañana de hoy hasta `todayUntil`.
 * Devuelve pacientes nuevos, turnos (sin código: los numera buildSeed por día) y auditoría.
 * `fixed` son visitas pasadas de pacientes con nombre, que se integran en su día.
 */
export function generateHistory({ now, days, todayUntil, seed = 2026, firstHc = 107, fixed = [] }) {
  const r = rng(seed);
  const patients = [];
  const turns = [];
  const audit = [];
  const lastVisitDay = new Map();
  let dniSeq = 71000000;
  let hcSeq = firstHc;

  const newPatient = () => {
    const sexo = r.chance(0.58) ? 'F' : 'M';
    const ageYears = r.weighted([[r.between(1, 11), 18], [r.between(12, 17), 8], [r.between(18, 29), 20], [r.between(30, 59), 36], [r.between(60, 88), 18]]);
    const birth = new Date(now - ageYears * 365.25 * DAY - r.between(0, 360) * DAY);
    const ant = ageYears >= 35 ? r.weighted([['', 60], ['Hipertensión arterial', 22], ['Diabetes mellitus tipo 2', 12], ['Asma bronquial', 6]]) : r.chance(0.08) ? 'Asma bronquial' : '';
    const p = {
      dni: String((dniSeq += r.between(1, 37))),
      nom: r.pick(sexo === 'F' ? NOMBRES_F : NOMBRES_M),
      ape: `${r.pick(APELLIDOS)} ${r.pick(APELLIDOS)}`,
      nac: birth.toISOString().slice(0, 10),
      sexo,
      tel: `9${r.between(10, 99)} ${r.between(100, 999)} ${r.between(100, 999)}`,
      sis: r.chance(0.8) ? 'ACTIVO' : 'NO_ASEGURADO',
      hc: `HC-${String(hcSeq++).padStart(6, '0')}`,
      ant,
      alg: r.weighted([['', 92], ['Penicilina', 4], ['AINE', 3], ['Sulfas', 1]]),
    };
    patients.push(p);
    return p;
  };

  const choosePatient = (dayKey) => {
    const returning = patients.filter((p) => lastVisitDay.get(p.dni) !== dayKey);
    const p = returning.length > 25 && r.chance(0.42) ? r.pick(returning) : newPatient();
    lastVisitDay.set(p.dni, dayKey);
    return p;
  };

  const chooseProfile = (p, ageYears) => {
    const chronic = PROFILES.find((x) => x.chronic && x.chronic === p.ant);
    if (chronic && r.chance(0.45)) return chronic;
    const fit = PROFILES.filter((x) => !x.chronic && (!x.ages || (ageYears >= x.ages[0] && ageYears <= x.ages[1])));
    return r.weighted(fit.map((x) => [x, x.w]));
  };

  const buildTurn = (p, t0, load, eff, fixedVisit) => {
    const ageYears = Math.floor((t0 - new Date(p.nac)) / (365.25 * DAY));
    const profile = fixedVisit?.profile || chooseProfile(p, ageYears);
    const tri = { ...vitalsFor(r, profile, p, ageYears), motivo: r.pick(profile.motivo) };
    const { prio } = evalTriage(tri, TH_DEFAULT);
    const area = r.chance(0.55) ? AREAS[0] : AREAS[1];
    const doc = DOCTORS[area];
    const tTriCall = t0 + Math.round((3 + r.next() * 6 + load * 0.9) * eff * MIN);
    const turn = { dni: p.dni, adm: 'a.admision', t0 };

    if (!fixedVisit && r.chance(0.03)) {
      return { ...turn, state: 'CANCELADO', prio: null, tTriCall, calls: 3, dest: 'Módulo de Triaje 1',
        cancel: { motivo: CANCEL.noShow, by: 'e.triaje', t: tTriCall + 6 * MIN } };
    }
    const tTriSave = tTriCall + Math.round(r.between(4, 9) * MIN);
    const waitMed = prio === 'CRITICA' ? r.between(1, 6) : prio === 'PRIORITARIA' ? r.between(5, 22) : (10 + r.next() * 28 + load * 2.2) * eff;
    const tMedCall = tTriSave + Math.round(waitMed * MIN);
    const base = { ...turn, prio, tTriCall, tTriSave, enf: 'e.triaje', tri };

    if (!fixedVisit && r.chance(0.02)) {
      return { ...base, state: 'CANCELADO', tMedCall, calls: 2, dest: area,
        cancel: { motivo: r.pick([CANCEL.noShow, CANCEL.retiro]), by: doc.u, t: tMedCall + 5 * MIN } };
    }
    const tEnd = tMedCall + Math.round(r.between(8, 21) * MIN);
    const destino = r.weighted(DEST_BY_PRIO[prio]);
    const meds = (fixedVisit?.meds || profile.meds).map((m) =>
      allergyConflicts(p.alg, [m.n]).length && SAFE_SWAP[m.n] ? SAFE_SWAP[m.n] : m,
    ).filter((m) => !allergyConflicts(p.alg, [m.n]).length);
    const code = fixedVisit?.dx || r.pick(profile.dx);
    return {
      ...base, state: 'ATENDIDO', tMedCall, tEnd, dest: area, med: doc.u,
      consult: {
        notas: profile.notas,
        dx: [[...cie(code), r.chance(0.72) ? 'D' : 'P']],
        meds,
        dest: destino,
        destx: destino === 'Reposo médico' ? String(r.between(1, 3)) : destino === 'Derivación a hospital' ? 'Hospital Regional (demo)' : '',
        t: tEnd, area, medico: doc,
      },
    };
  };

  // Las visitas fijas que caen en domingo (cerrado) pasan al sábado anterior
  const fixedDay = (f) => {
    const d = startOfDay(now - f.daysAgo * DAY);
    return new Date(d).getDay() === 0 ? startOfDay(d - DAY / 2) : d;
  };

  for (let d = days; d >= 0; d--) {
    const dayStart = startOfDay(now - d * DAY);
    const dow = new Date(dayStart).getDay();
    if (dow === 0) continue; // domingo: el centro no atiende
    const dayFixed = fixed.filter((f) => fixedDay(f) === dayStart);
    const until = d === 0 ? todayUntil : Infinity;
    // Mejora gradual de los tiempos a lo largo del periodo (adopción del sistema)
    const eff = 0.92 + 0.36 * (d / days);
    const n = Math.max(6, Math.round(BASE_BY_DOW[dow] * (0.9 + 0.2 * r.next()) + r.between(-3, 3)));
    const hours = dow === 6 ? HOUR_WEIGHTS.slice(0, 5) : HOUR_WEIGHTS;
    const arrivals = Array.from({ length: n }, () => dayStart + (r.weighted(hours) * 60 + r.between(0, 59)) * MIN).sort((a, b) => a - b);
    const perHour = new Map();
    arrivals.forEach((t) => perHour.set(new Date(t).getHours(), (perHour.get(new Date(t).getHours()) || 0) + 1));

    const dayKey = dayStart;
    arrivals.forEach((t0) => {
      if (t0 >= until) return;
      const t = buildTurn(choosePatient(dayKey), t0, perHour.get(new Date(t0).getHours()) || 1, eff);
      turns.push(t);
    });
    dayFixed.forEach((f) => {
      const t0 = dayStart + f.at * MIN;
      lastVisitDay.set(f.patient.dni, dayKey);
      turns.push(buildTurn(f.patient, t0, 2, eff, f));
    });

    if (dayStart + 7 * 60 * MIN < Math.min(until, now)) {
      STAFF.forEach((u, i) => audit.push({ t: dayStart + (6 * 60 + 45 + i * 3) * MIN, u, a: 'LOGIN', d: `Inicio de sesión de ${u}` }));
      if (d > 0) STAFF.forEach((u, i) => audit.push({ t: dayStart + ((dow === 6 ? 13 : 17) * 60 + i * 4) * MIN, u, a: 'LOGOUT', d: `Cierre de sesión de ${u}` }));
    }
  }
  return { patients, turns, audit };
}
