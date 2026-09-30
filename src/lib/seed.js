import { CIE, DAY, MIN, TH_DEFAULT, FAKE_IPS } from './constants.js';

const DOC = { u: 'm.consulta', n: 'Dra. Elena Ríos (demo)', col: 'CMP-00000' };

/** Datos de demostración. Los tiempos son relativos al momento en que se siembran. */
export function buildSeed(now = Date.now()) {
  const consult = (t, dx, meds, rec) => ({
    notas: 'Evolución favorable.', dx, meds, dest: 'Alta', destx: '', rec, t, area: 'Consultorio 1', medico: DOC,
  });
  const med = (n, dosis, frec, dias) => ({ n, dosis, frec, dias, cant: '' });
  const vit = (motivo, extra = {}) => ({ pa: '118/76', fc: 76, fr: 16, t: 36.7, spo2: 97, peso: 69.8, talla: 1.65, motivo, ...extra });

  const past = (id, dni, daysAgo, dx, meds, rec) => {
    const b = now - daysAgo * DAY;
    return {
      id, dni, state: 'ATENDIDO', prio: 'NORMAL', t0: b, tTriCall: b + 8 * MIN, tTriSave: b + 14 * MIN,
      tMedCall: b + 30 * MIN, tEnd: b + 45 * MIN, dest: 'Consultorio 1', enf: 'e.triaje', med: DOC.u,
      tri: vit('Control'), consult: consult(b + 45 * MIN, dx, meds, rec),
    };
  };
  const today = (id, dni, [a, b, c, d, e], rec) => ({
    id, dni, state: 'ATENDIDO', prio: 'NORMAL', t0: now - a * MIN, tTriCall: now - b * MIN, tTriSave: now - c * MIN,
    tMedCall: now - d * MIN, tEnd: now - e * MIN, dest: 'Consultorio 1', enf: 'e.triaje', med: DOC.u,
    tri: vit('Malestar general', { pa: '120/80', peso: 72, talla: 1.7 }),
    consult: consult(now - e * MIN, [[...CIE[1], 'D']], [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)], rec),
  });

  const turns = [
    past('TR-018', '70000001', 34, [[...CIE[1], 'D']], [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)], 'REC-2026-000305'),
    past('TR-031', '70000001', 12, [[...CIE[3], 'D']], [med('Salbutamol inhalador', '2 puff', 'cada 6 h', 5)], 'REC-2026-000377'),
    past('TR-022', '70000002', 20, [[...CIE[6], 'D']], [med('Ibuprofeno 400 mg', '1 tableta', 'cada 8 h', 2)], 'REC-2026-000341'),
    today('TR-041', '70000006', [150, 140, 132, 120, 105], 'REC-2026-000409'),
    today('TR-042', '70000005', [130, 118, 110, 95, 80], 'REC-2026-000410'),
    today('TR-043', '70000004', [100, 90, 84, 70, 58], 'REC-2026-000411'),
    {
      id: 'TR-044', dni: '70000001', state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', enf: 'e.triaje',
      t0: now - 40 * MIN, tTriCall: now - 36 * MIN, tTriSave: now - 33 * MIN,
      tri: vit('Dolor de garganta y tos de 3 días', { pa: '120/80', fc: 72, t: 36.6, peso: 70.2 }),
    },
    {
      id: 'TR-045', dni: '70000002', state: 'LLAMADO_CONSULTA', prio: 'PRIORITARIA', enf: 'e.triaje',
      t0: now - 30 * MIN, tTriCall: now - 27 * MIN, tTriSave: now - 22 * MIN, tMedCall: now - 2 * MIN,
      calledAt: now - 2 * MIN, dest: 'Consultorio 1',
      tri: { pa: '150/95', fc: 104, fr: 22, t: 38.6, spo2: 93, peso: 82, talla: 1.72, motivo: 'Fiebre y dificultad leve para respirar' },
    },
    { id: 'TR-046', dni: '70000003', state: 'EN_ESPERA_TRIAJE', prio: null, t0: now - 12 * MIN },
    { id: 'TR-047', dni: '70000004', state: 'EN_ESPERA_TRIAJE', prio: null, t0: now - 5 * MIN },
  ];

  const patients = [
    { dni: '70000001', nom: 'Lucía', ape: 'Paredes Quispe', nac: '1988-04-12', sexo: 'F', tel: '999 000 101', sis: 'ACTIVO', hc: 'HC-000101', ant: 'Asma bronquial en la infancia', alg: 'Penicilina' },
    { dni: '70000002', nom: 'Mateo', ape: 'Salas Huamán', nac: '1976-11-03', sexo: 'M', tel: '999 000 102', sis: 'ACTIVO', hc: 'HC-000102', ant: 'Hipertensión arterial', alg: '' },
    { dni: '70000003', nom: 'Rosa', ape: 'Contreras Vega', nac: '1959-02-27', sexo: 'F', tel: '999 000 103', sis: 'ACTIVO', hc: 'HC-000103', ant: 'Diabetes mellitus tipo 2', alg: 'AINE' },
    { dni: '70000004', nom: 'Diego', ape: 'Ramos Torres', nac: '2001-07-19', sexo: 'M', tel: '999 000 104', sis: 'NO_ASEGURADO', hc: 'HC-000104', ant: '', alg: '' },
    { dni: '70000005', nom: 'Ana', ape: 'Flores Mamani', nac: '1994-09-30', sexo: 'F', tel: '999 000 105', sis: 'ACTIVO', hc: 'HC-000105', ant: '', alg: '' },
    { dni: '70000006', nom: 'Julio', ape: 'Cárdenas Rojas', nac: '1983-01-15', sexo: 'M', tel: '999 000 106', sis: 'ACTIVO', hc: 'HC-000106', ant: '', alg: '' },
  ];

  const users = [
    { u: 'a.admision', n: 'Carla Vidal (demo)', role: 'adm', col: '', on: true },
    { u: 'e.triaje', n: 'Pedro Luna (demo)', role: 'enf', col: 'CEP-00000', on: true },
    { u: 'm.consulta', n: 'Dra. Elena Ríos (demo)', role: 'med', col: 'CMP-00000', on: true },
    { u: 'm.consulta2', n: 'Dr. Luis Paz (demo)', role: 'med', col: 'CMP-00001', on: true },
    { u: 'j.jefatura', n: 'Marco Soto (demo)', role: 'jef', col: '', on: true },
    { u: 'e.turno2', n: 'Iris Campos (demo)', role: 'enf', col: 'CEP-00001', on: false },
  ];

  const audit = [
    ['UMBRALES', 'Umbrales aprobados por Dra. Elena Ríos (demo)', 'j.jefatura', 20 * DAY],
    ['LOGIN', 'Inicio de sesión de e.triaje', 'e.triaje', 95 * MIN],
    ['TURNO_CREADO', 'TR-044 registrado', 'a.admision', 40 * MIN],
    ['TRIAJE_GUARDADO', 'TR-044 prioridad NORMAL', 'e.triaje', 33 * MIN],
    ['LLAMADO', 'TR-045 → Consultorio 1', 'm.consulta', 2 * MIN],
  ].map(([a, d, u, ago], i) => ({ id: `seed-${i}`, t: now - ago, u, a, d, ip: FAKE_IPS[u] }))
    .sort((x, y) => y.t - x.t);

  const thresholds = [{ id: 'seed-th', vals: { ...TH_DEFAULT }, by: 'Dra. Elena Ríos (demo)', since: now - 20 * DAY }];

  return { patients, turns, users, audit, thresholds };
}
