import { CIE, DAY, MIN, TH_DEFAULT, FAKE_IPS, HISTORY_DAYS } from './constants.js';
import { startOfDay } from './format.js';
import { generateHistory, DOCTORS, med } from './seedHistory.js';

/**
 * Datos de demostración: seis pacientes con nombre (los que se usan al presentar), varias semanas
 * de atenciones generadas y un escenario «en vivo» relativo al momento en que se siembra.
 */
const NAMED = [
  { dni: '70000001', nom: 'Lucía', ape: 'Paredes Quispe', nac: '1988-04-12', sexo: 'F', tel: '999 000 101', sis: 'ACTIVO', hc: 'HC-000101', ant: 'Asma bronquial en la infancia', alg: 'Penicilina' },
  { dni: '70000002', nom: 'Mateo', ape: 'Salas Huamán', nac: '1976-11-03', sexo: 'M', tel: '999 000 102', sis: 'ACTIVO', hc: 'HC-000102', ant: 'Hipertensión arterial', alg: '' },
  { dni: '70000003', nom: 'Rosa', ape: 'Contreras Vega', nac: '1959-02-27', sexo: 'F', tel: '999 000 103', sis: 'ACTIVO', hc: 'HC-000103', ant: 'Diabetes mellitus tipo 2', alg: 'AINE' },
  { dni: '70000004', nom: 'Diego', ape: 'Ramos Torres', nac: '2001-07-19', sexo: 'M', tel: '999 000 104', sis: 'NO_ASEGURADO', hc: 'HC-000104', ant: '', alg: '' },
  { dni: '70000005', nom: 'Ana', ape: 'Flores Mamani', nac: '1994-09-30', sexo: 'F', tel: '999 000 105', sis: 'ACTIVO', hc: 'HC-000105', ant: '', alg: '' },
  { dni: '70000006', nom: 'Julio', ape: 'Cárdenas Rojas', nac: '1983-01-15', sexo: 'M', tel: '999 000 106', sis: 'ACTIVO', hc: 'HC-000106', ant: '', alg: '' },
];

export const DEMO_USERS = [
  { u: 'a.admision', n: 'Carla Vidal (demo)', role: 'adm', col: '', on: true },
  { u: 'e.triaje', n: 'Pedro Luna (demo)', role: 'enf', col: 'CEP-00000', on: true },
  { u: 'm.consulta', n: 'Dra. Elena Ríos (demo)', role: 'med', col: 'CMP-00000', on: true },
  { u: 'm.consulta2', n: 'Dr. Luis Paz (demo)', role: 'med', col: 'CMP-00001', on: true },
  { u: 'j.jefatura', n: 'Marco Soto (demo)', role: 'jef', col: '', on: true },
  { u: 'e.turno2', n: 'Iris Campos (demo)', role: 'enf', col: 'CEP-00001', on: false },
];

const byCode = (code) => CIE.find((c) => c[0] === code);
const vit = (motivo, extra = {}) => ({ pa: '118/76', fc: 76, fr: 16, t: 36.7, spo2: 97, peso: 69.8, talla: 1.65, motivo, ...extra });

/** Visitas pasadas de los pacientes con nombre (se ven en su historia clínica). */
const FIXED = [
  { p: 0, daysAgo: 33, at: 8 * 60 + 20, dx: 'J06.9', meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)], motivo: 'Dolor de garganta y tos' },
  { p: 0, daysAgo: 12, at: 9 * 60 + 5, dx: 'J20.9', meds: [med('Salbutamol inhalador', '2 puff', 'cada 6 h', 5)], motivo: 'Tos persistente con flema' },
  { p: 1, daysAgo: 20, at: 7 * 60 + 40, dx: 'I10', meds: [med('Enalapril 10 mg', '1 tableta', 'cada 12 h', 30)], motivo: 'Control de presión arterial' },
  { p: 2, daysAgo: 27, at: 10 * 60 + 15, dx: 'E11.9', meds: [med('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)], motivo: 'Control de glucosa' },
];

/** Escenario de hoy: minutos antes de `now` para [llegada, llamado a triaje, fin de triaje, llamado a consulta, alta]. */
function liveTurns(now, extra) {
  const at = (m) => (m == null ? undefined : now - m * MIN);
  const done = (dni, [a, b, c, d, e], dx, meds, area = 'Consultorio 1') => ({
    dni, adm: 'a.admision', state: 'ATENDIDO', prio: 'NORMAL', t0: at(a), tTriCall: at(b), tTriSave: at(c), tMedCall: at(d), tEnd: at(e),
    dest: area, enf: 'e.triaje', med: DOCTORS[area].u, tri: vit('Malestar general', { pa: '120/80', peso: 72, talla: 1.7 }),
    consult: { notas: 'Evolución favorable.', dx: [[...byCode(dx), 'D']], meds, dest: 'Alta', destx: '', t: at(e), area, medico: DOCTORS[area] },
  });
  return [
    done('70000006', [150, 140, 132, 120, 105], 'J06.9', [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)]),
    done('70000005', [130, 118, 110, 95, 80], 'K29.7', [med('Omeprazol 20 mg', '1 cápsula', 'cada 24 h', 14)], 'Consultorio 2'),
    done('70000004', [100, 90, 84, 70, 58], 'M54.5', [med('Naproxeno 550 mg', '1 tableta', 'cada 12 h', 5)]),
    {
      dni: '70000001', adm: 'a.admision', state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', enf: 'e.triaje',
      t0: at(40), tTriCall: at(36), tTriSave: at(33),
      tri: vit('Dolor de garganta y tos de 3 días', { pa: '120/80', fc: 72, t: 36.6, peso: 70.2 }),
    },
    {
      dni: '70000002', adm: 'a.admision', state: 'LLAMADO_CONSULTA', prio: 'PRIORITARIA', enf: 'e.triaje',
      t0: at(30), tTriCall: at(27), tTriSave: at(22), tMedCall: at(2), calledAt: at(2), calls: 1, dest: 'Consultorio 1',
      tri: { pa: '150/95', fc: 104, fr: 22, t: 38.6, spo2: 93, peso: 82, talla: 1.72, motivo: 'Fiebre y dificultad leve para respirar' },
    },
    {
      dni: extra[0].dni, adm: 'a.admision', state: 'EN_ESPERA_CONSULTA', prio: 'CRITICA', enf: 'e.triaje',
      t0: at(18), tTriCall: at(15), tTriSave: at(8),
      tri: { pa: '104/66', fc: 118, fr: 29, t: 39.3, spo2: 89, peso: 64, talla: 1.6, motivo: 'Dificultad respiratoria y fiebre alta' },
    },
    { dni: '70000003', adm: 'a.admision', state: 'EN_ESPERA_TRIAJE', prio: null, t0: at(12) },
    { dni: extra[1].dni, adm: 'a.admision', state: 'EN_ESPERA_TRIAJE', prio: null, t0: at(5) },
  ];
}

/** Numera los turnos por día (TR-001…) y las recetas por año, en orden cronológico. */
function numberTurns(turns) {
  const perDay = new Map();
  const perYear = new Map();
  turns.sort((a, b) => a.t0 - b.t0);
  turns.forEach((t) => {
    const day = startOfDay(t.t0);
    perDay.set(day, (perDay.get(day) || 0) + 1);
    t.id = `TR-${String(perDay.get(day)).padStart(3, '0')}`;
  });
  turns.filter((t) => t.consult).sort((a, b) => a.consult.t - b.consult.t).forEach((t) => {
    const y = new Date(t.consult.t).getFullYear();
    perYear.set(y, (perYear.get(y) ?? 300) + 1);
    t.consult.rec = `REC-${y}-${String(perYear.get(y)).padStart(6, '0')}`;
  });
  return turns;
}

/**
 * Auditoría de los dos últimos días con el mismo detalle que registra la app (antes de eso, la demo solo
 * guarda los ingresos y salidas del personal, para no cargar miles de eventos).
 */
function turnAudit(turns, patients, from) {
  const hc = new Map(patients.map((p) => [p.dni, p.hc]));
  return turns.filter((t) => t.t0 >= from).flatMap((t) => {
    const doc = DOCTORS[t.dest]?.u;
    const ev = [{ t: t.t0, u: t.adm, a: 'TURNO_CREADO', d: `${t.id} registrado` }];
    if (t.tTriCall) ev.push({ t: t.tTriCall, u: 'e.triaje', a: 'LLAMADO', d: `${t.id} → Módulo de Triaje 1` });
    if (t.tTriSave && t.prio) ev.push({ t: t.tTriSave, u: 'e.triaje', a: 'TRIAJE_GUARDADO', d: `${t.id} prioridad ${t.prio}` });
    if (t.tMedCall && doc) ev.push({ t: t.tMedCall, u: doc, a: 'LLAMADO', d: `${t.id} → ${t.dest}` });
    if (t.consult) {
      ev.push({ t: t.tMedCall + MIN, u: t.consult.medico.u, a: 'HC_CONSULTADA', d: `${hc.get(t.dni)} abierta en consulta` });
      ev.push({ t: t.tEnd, u: t.consult.medico.u, a: 'ATENCION_FINALIZADA', d: `${t.id} · ${t.consult.rec} · ${t.consult.dest}` });
    }
    if (t.state === 'CANCELADO') ev.push({ t: t.cancel.t, u: t.cancel.by, a: 'TURNO_CANCELADO', d: `${t.id} · ${t.cancel.motivo}` });
    return ev;
  });
}

export function buildSeed(now = Date.now()) {
  const fixed = FIXED.map((f) => ({
    patient: NAMED[f.p], daysAgo: f.daysAgo, at: f.at, dx: f.dx, meds: f.meds,
    profile: { motivo: [f.motivo], notas: 'Evolución favorable.', meds: f.meds },
  }));
  const hist = generateHistory({ now, days: HISTORY_DAYS, todayUntil: now - 160 * MIN, fixed });
  const namedDni = new Set(NAMED.map((p) => p.dni));
  const busyToday = new Set(hist.turns.filter((t) => t.t0 >= startOfDay(now)).map((t) => t.dni));
  const extra = hist.patients.filter((p) => !namedDni.has(p.dni) && !busyToday.has(p.dni)).slice(0, 2);

  const turns = numberTurns([...hist.turns, ...liveTurns(now, extra)]);
  const patients = [...NAMED, ...hist.patients];

  const audit = [
    ...hist.audit,
    ...turnAudit(turns, patients, startOfDay(now - DAY)),
    { t: now - 40 * DAY, u: 'j.jefatura', a: 'UMBRALES', d: 'Umbrales aprobados por Dra. Elena Ríos (demo)' },
  ].map((x, i) => ({ id: `seed-${i}`, ip: FAKE_IPS[x.u], ...x })).sort((x, y) => y.t - x.t);

  const thresholds = [
    // La versión vigente cubre toda la historia generada (que se prioriza con TH_DEFAULT)
    { id: 'seed-th-1', vals: { ...TH_DEFAULT, spo2: 92, spo2A: 94, tmpA: 38.3 }, by: 'Dr. Luis Paz (demo)', since: now - 90 * DAY },
    { id: 'seed-th-2', vals: { ...TH_DEFAULT }, by: 'Dra. Elena Ríos (demo)', since: now - (HISTORY_DAYS + 5) * DAY },
  ];

  return { patients, turns, users: DEMO_USERS.map((u) => ({ ...u })), audit, thresholds };
}
