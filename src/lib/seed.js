import { CIE, DAY, MIN, TH_DEFAULT, FAKE_IPS, HISTORY_DAYS, TARIFA_CONSULTA, ACTIVE_STATES, SERIE_BOLETA } from './constants.js';
import { evalTriage } from './clinical.js';
import { cuposLibres } from './agenda.js';
import { fmtHora, startOfDay } from './format.js';
import { generateHistory, med, medico, DEMO_USERS, DEMO_HORARIOS } from './seedHistory.js';

export { DEMO_USERS, DEMO_HORARIOS };

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

const byCode = (code) => CIE.find((c) => c[0] === code);
const vit = (motivo, extra = {}) => ({ pa: '118/76', fc: 76, fr: 16, t: 36.7, spo2: 97, peso: 69.8, talla: 1.65, motivo, ...extra });

/** Visitas pasadas de los pacientes con nombre (se ven en su historia clínica). */
const FIXED = [
  { p: 0, daysAgo: 33, at: 8 * 60 + 20, dx: 'J06.9', meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)], motivo: 'Dolor de garganta y tos' },
  { p: 0, daysAgo: 12, at: 9 * 60 + 5, dx: 'J20.9', meds: [med('Salbutamol inhalador', '2 puff', 'cada 6 h', 5)], motivo: 'Tos persistente con flema' },
  { p: 1, daysAgo: 20, at: 7 * 60 + 40, dx: 'I10', meds: [med('Enalapril 10 mg', '1 tableta', 'cada 12 h', 30)], motivo: 'Control de presión arterial' },
  { p: 2, daysAgo: 27, at: 10 * 60 + 15, dx: 'E11.9', meds: [med('Metformina 850 mg', '1 tableta', 'cada 12 h', 30)], motivo: 'Control de glucosa' },
];

/** Pago de la consulta: con SIS se exonera al registrar el turno; sin seguro se paga en Caja. */
const pagoDe = (p, t) => (p.sis === 'NO_ASEGURADO'
  ? { tPago: t + 3 * MIN, pago: { metodo: 'EFECTIVO', monto: TARIFA_CONSULTA, comp: null, by: 'c.caja', t: t + 3 * MIN } }
  : { tPago: t, pago: { metodo: 'SIS', monto: 0, comp: null, by: 'a.admision', t } });

/** Cita de Medicina General con la Dra. Ríos (la cuenta que se usa al presentar la consulta). */
const citaMG = (tCita, at, u = 'm.consulta', sobre = false) => ({
  tCita, cita: { esp: 'MG', med: u, area: 'Consultorio 1', at, sobre, by: 'a.admision', t: tCita },
});

/** Turno con prioridad calculada igual que en triaje. */
const triaged = (t) => ({ ...t, prio: evalTriage(t.tri, TH_DEFAULT).prio });

/** Último día de atención antes de hoy (el domingo el centro no atiende). */
const prevWorkday = (now) => {
  const d = startOfDay(startOfDay(now) - DAY / 2);
  return new Date(d).getDay() === 0 ? startOfDay(d - DAY / 2) : d;
};

/**
 * Escenario de hoy, relativo a `now`: un paciente en cada punto de la ruta para presentar el sistema.
 * Hay pacientes atendidos, en consulta, en espera (uno crítico con sobrecupo), en triaje, en Caja,
 * esperando su cita, citados para hoy y citados para otro día (Cardiología solo atiende martes y jueves).
 */
function liveTurns(now, extra, agenda) {
  const at = (m) => (m == null ? undefined : now - m * MIN);
  const named = (dni) => NAMED.find((p) => p.dni === dni);
  const done = (p, [a, b, c, d, e], dx, meds, u = 'm.consulta') => {
    const cita = citaMG(at(c) + 2 * MIN, at(c) + 5 * MIN, u);
    return {
      dni: p.dni, adm: 'a.admision', state: 'ATENDIDO', t0: at(a), ...pagoDe(p, at(a)), tTriCall: at(b), tTriSave: at(c),
      ...cita, llego: cita.tCita, tLlega: cita.cita.at, tMedCall: at(d), tEnd: at(e), dest: 'Consultorio 1', enf: 'e.triaje', med: u,
      ...triaged({ tri: vit('Malestar general', { pa: '120/80', peso: 72, talla: 1.7 }) }),
      consult: { notas: 'Evolución favorable.', dx: [[...byCode(dx), 'D']], meds, dest: 'Alta', destx: '', t: at(e), area: 'Consultorio 1', medico: medico(u) },
    };
  };
  const present = (p, [a, b, c], tri, cita) => ({
    dni: p.dni, adm: 'a.admision', t0: at(a), ...pagoDe(p, at(a)), tTriCall: at(b), tTriSave: at(c), enf: 'e.triaje',
    ...triaged({ tri }), ...cita, llego: cita.tCita, tLlega: Math.max(cita.tCita, cita.cita.at),
  });

  // Pacientes que se triaron el día anterior y tienen cita pendiente
  const prev = prevWorkday(now);
  const ayer = (p, h, tri, cita) => {
    const t0 = prev + h * 60 * MIN;
    return { dni: p.dni, adm: 'a.admision', state: 'CITADO', t0, ...pagoDe(p, t0), tTriCall: t0 + 9 * MIN, tTriSave: t0 + 15 * MIN, enf: 'e.triaje', ...triaged({ tri }), ...cita };
  };
  // Cardiología: el primer cupo libre desde ahora (si hoy no es martes ni jueves, cae otro día)
  const car = cuposLibres(agenda, 'CAR', now, { limit: 1 })[0];
  // Medicina General: un cupo libre de hoy, en lo que queda del día; si no hay, una hora cercana
  const mgHoy = cuposLibres(agenda, 'MG', now + 30 * MIN, { dias: 0, limit: 1 })[0];
  let later = Math.ceil((now + 40 * MIN) / (5 * MIN)) * 5 * MIN;
  if (new Date(later).getMinutes() % 20 === 0) later += 5 * MIN; // fuera del inicio de un cupo de 20 min
  const t0Ayer = (h) => prev + h * 60 * MIN;

  return [
    done(named('70000006'), [150, 140, 132, 120, 105], 'J06.9', [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)]),
    done(named('70000005'), [130, 118, 110, 95, 80], 'K29.7', [med('Omeprazol 20 mg', '1 cápsula', 'cada 24 h', 14)], 'm.consulta2'),
    done(extra[5], [100, 90, 84, 70, 58], 'M54.5', [med('Naproxeno 550 mg', '1 tableta', 'cada 12 h', 5)]),
    {
      ...present(named('70000001'), [40, 36, 33], vit('Dolor de garganta y tos de 3 días', { pa: '120/80', fc: 72, t: 36.6, peso: 70.2 }), citaMG(at(31), at(8))),
      state: 'EN_ESPERA_CONSULTA',
    },
    {
      ...present(named('70000002'), [30, 27, 22], { pa: '150/95', fc: 104, fr: 22, t: 38.6, spo2: 93, peso: 82, talla: 1.72, motivo: 'Fiebre y dificultad leve para respirar' }, citaMG(at(20), at(6))),
      state: 'LLAMADO_CONSULTA', tMedCall: at(2), calledAt: at(2), calls: 1, dest: 'Consultorio 1',
    },
    {
      ...present(extra[0], [18, 15, 8], { pa: '104/66', fc: 118, fr: 29, t: 39.3, spo2: 89, peso: 64, talla: 1.6, motivo: 'Dificultad respiratoria y fiebre alta' }, citaMG(at(7), at(7), 'm.consulta', true)),
      state: 'EN_ESPERA_CONSULTA',
    },
    {
      dni: extra[2].dni, adm: 'a.admision', state: 'PENDIENTE_CITA', t0: at(45), ...pagoDe(extra[2], at(45)), tTriCall: at(30), tTriSave: at(6), enf: 'e.triaje',
      ...triaged({ tri: vit('Control de presión arterial y palpitaciones', { pa: '138/88', fc: 84 }) }),
    },
    { dni: '70000003', adm: 'a.admision', state: 'EN_ESPERA_TRIAJE', prio: null, t0: at(12), ...pagoDe(named('70000003'), at(12)) },
    { dni: extra[1].dni, adm: 'a.admision', state: 'EN_ESPERA_TRIAJE', prio: null, t0: at(9), ...pagoDe(extra[1], at(9)) },
    { dni: '70000004', adm: 'a.admision', state: 'PENDIENTE_PAGO', prio: null, t0: at(3) },
    ...(car ? [ayer(extra[3], 10.25, vit('Control de presión arterial', { pa: '146/92', fc: 82 }),
      { tCita: t0Ayer(10.6), cita: { esp: 'CAR', med: car.med, area: car.area, at: car.at, sobre: false, by: 'a.admision', t: t0Ayer(10.6) } })] : []),
    ayer(extra[4], 11, vit('Dolor de cabeza intenso', { pa: '124/80' }),
      mgHoy ? { tCita: t0Ayer(11.4), cita: { esp: 'MG', med: mgHoy.med, area: mgHoy.area, at: mgHoy.at, sobre: false, by: 'a.admision', t: t0Ayer(11.4) } }
        : citaMG(t0Ayer(11.4), later)),
  ];
}

/** Numera los turnos por día (TR-001…), las boletas en su serie y las recetas por año, en orden cronológico. */
function numberTurns(turns) {
  const perDay = new Map();
  const perYear = new Map();
  turns.sort((a, b) => a.t0 - b.t0);
  // Como en nextTurnId: el código de cada día sigue después de los turnos de días anteriores que siguen
  // abiertos (un citado conserva su código hasta su cita), para que nunca se repita entre turnos abiertos.
  let openMax = 0;
  let curDay = null;
  const open = [];
  turns.forEach((t) => {
    const day = startOfDay(t.t0);
    if (day !== curDay) {
      openMax = Math.max(openMax, ...open.map((x) => +x.id.slice(3)));
      curDay = day;
    }
    perDay.set(day, Math.max(perDay.get(day) || 0, openMax) + 1);
    t.id = `TR-${String(perDay.get(day)).padStart(3, '0')}`;
    if (ACTIVE_STATES.includes(t.state)) open.push(t);
  });
  let boleta = 4000;
  turns.filter((t) => t.pago && t.pago.metodo !== 'SIS').sort((a, b) => a.pago.t - b.pago.t).forEach((t) => {
    t.pago.comp = `${SERIE_BOLETA}-${String(++boleta).padStart(6, '0')}`;
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
    const ev = [{ t: t.t0, u: t.adm, a: 'TURNO_CREADO', d: `${t.id} registrado` }];
    if (t.pago) {
      ev.push({ t: t.pago.t, u: t.pago.by, a: 'PAGO_REGISTRADO', d: t.pago.metodo === 'SIS' ? `${t.id} exonerado por SIS` : `${t.id} · ${t.pago.comp} · S/ ${t.pago.monto.toFixed(2)}` });
    }
    if (t.tTriCall) ev.push({ t: t.tTriCall, u: 'e.triaje', a: 'LLAMADO', d: `${t.id} → Módulo de Triaje 1` });
    if (t.tTriSave && t.prio) ev.push({ t: t.tTriSave, u: 'e.triaje', a: 'TRIAJE_GUARDADO', d: `${t.id} prioridad ${t.prio}` });
    if (t.cita) ev.push({ t: t.tCita, u: t.cita.by, a: 'CITA_ASIGNADA', d: `${t.id} → ${t.cita.esp} con ${t.cita.med} a las ${fmtHora(t.cita.at)}${t.cita.sobre ? ' (sobrecupo)' : ''}` });
    if (t.cita && t.llego && startOfDay(t.cita.at) !== startOfDay(t.tCita)) {
      ev.push({ t: t.llego, u: 'a.admision', a: 'LLEGADA_CITA', d: `${t.id} llegó a su cita de las ${fmtHora(t.cita.at)}` });
    }
    if (t.tMedCall && t.cita) ev.push({ t: t.tMedCall, u: t.cita.med, a: 'LLAMADO', d: `${t.id} → ${t.dest}` });
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
  // Los pacientes del escenario no pueden tener otro turno hoy ni uno abierto (una cita pendiente)
  const busy = new Set(hist.turns.filter((t) => t.t0 >= prevWorkday(now) || ACTIVE_STATES.includes(t.state)).map((t) => t.dni));
  const extra = hist.patients.filter((p) => !namedDni.has(p.dni) && !busy.has(p.dni) && p.nac < `${new Date(now).getFullYear() - 14}`).slice(0, 6);

  const agenda = { users: DEMO_USERS, horarios: DEMO_HORARIOS, turns: hist.turns };
  const turns = numberTurns([...hist.turns, ...liveTurns(now, extra, agenda)]);
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

  return {
    patients, turns, audit, thresholds,
    users: DEMO_USERS.map((u) => ({ ...u })),
    horarios: DEMO_HORARIOS.map((h) => ({ ...h })),
  };
}
