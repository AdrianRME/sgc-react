import { describe, it, expect } from 'vitest';
import {
  evalTriage, validateVitals, validateThresholds, allergyConflicts, canTransition, byPriority, calcIMC,
} from '../clinical.js';
import { TH_DEFAULT } from '../constants.js';
import { nextTurnId, nextRecipe, nextHC } from '../ids.js';
import { buildSeed } from '../seed.js';
import {
  createTurn, registerPayment, callTurn, callNext, startTriage, saveTriage, returnToQueue, assignCita, checkIn, startConsult, finishConsult, toggleUser,
} from '../../store/actions.js';
import { especialidadSugerida, isoDow, sugerirCita } from '../agenda.js';
import { applyChanges } from '../../data/merge.js';

const normal = { pa: '120/80', fc: 75, fr: 16, t: 36.6, spo2: 98, peso: 70, talla: 1.7, motivo: 'Control' };

describe('triaje', () => {
  it('asigna NORMAL con signos normales', () => {
    expect(evalTriage(normal, TH_DEFAULT).prio).toBe('NORMAL');
  });
  it('asigna CRITICA si SpO₂ está bajo el umbral crítico', () => {
    const r = evalTriage({ ...normal, spo2: 88 }, TH_DEFAULT);
    expect(r.prio).toBe('CRITICA');
    expect(r.status.spo2).toBe('crit');
  });
  it('asigna PRIORITARIA con fiebre de alerta', () => {
    expect(evalTriage({ ...normal, t: 38.6 }, TH_DEFAULT).prio).toBe('PRIORITARIA');
  });
  it('calcula el IMC', () => {
    expect(calcIMC(70, 1.7)).toBe(24.22);
  });
  it('rechaza PA con diastólica mayor que sistólica', () => {
    expect(validateVitals({ ...normal, pa: '80/120' }).pa).toBeTruthy();
  });
});

describe('umbrales', () => {
  it('acepta los valores por defecto', () => {
    expect(validateThresholds(TH_DEFAULT)).toEqual([]);
  });
  it('rechaza alerta de SpO₂ menor que el crítico', () => {
    expect(validateThresholds({ ...TH_DEFAULT, spo2A: 85 }).length).toBe(1);
  });
});

describe('alergias', () => {
  it('detecta amoxicilina en paciente alérgico a penicilina', () => {
    expect(allergyConflicts('Penicilina', ['Amoxicilina 500 mg'])).toHaveLength(1);
  });
  it('detecta ibuprofeno en paciente alérgico a AINE', () => {
    expect(allergyConflicts('AINE', ['Ibuprofeno 400 mg', 'Paracetamol 500 mg'])).toHaveLength(1);
  });
  it('no marca nada sin alergias', () => {
    expect(allergyConflicts('', ['Amoxicilina 500 mg'])).toEqual([]);
  });
});

describe('colas y correlativos', () => {
  it('ordena por prioridad y luego por llegada', () => {
    const q = [{ prio: 'NORMAL', t0: 1 }, { prio: 'CRITICA', t0: 5 }, { prio: 'NORMAL', t0: 0 }].sort(byPriority);
    expect(q.map((x) => x.t0)).toEqual([5, 0, 1]);
  });
  it('el código de turno se reinicia cada día y no choca con turnos abiertos', () => {
    const now = new Date(2026, 8, 30, 10, 0).getTime();
    const ayer = now - 86_400_000;
    const turns = [
      { id: 'TR-031', t0: ayer, state: 'ATENDIDO' },
      { id: 'TR-002', t0: now - 60_000, state: 'EN_ESPERA_TRIAJE' },
    ];
    expect(nextTurnId(turns, now)).toBe('TR-003');
    expect(nextTurnId([...turns, { id: 'TR-040', t0: ayer, state: 'EN_ESPERA_CONSULTA' }], now)).toBe('TR-041');
    expect(nextTurnId([], now)).toBe('TR-001');
  });
  it('la receta continúa el correlativo del año que informa el servidor', () => {
    const turns = [{ consult: { rec: 'REC-2026-000010' } }];
    expect(nextRecipe(turns, 2026)).toBe('REC-2026-000011');
    expect(nextRecipe(turns, 2026, 950)).toBe('REC-2026-000951');
    expect(nextRecipe(turns, 2027)).toBe('REC-2027-000001');
  });
  it('la historia clínica sigue al último número registrado', () => {
    const db = buildSeed();
    const max = Math.max(...db.patients.map((p) => +p.hc.slice(3)));
    expect(nextHC(db.patients)).toBe(`HC-${String(max + 1).padStart(6, '0')}`);
  });
  it('no permite saltar etapas', () => {
    expect(canTransition('EN_ESPERA_TRIAJE', 'EN_CONSULTA')).toBe(false);
    expect(canTransition('ATENDIDO', 'CANCELADO')).toBe(false);
    expect(canTransition('PENDIENTE_PAGO', 'LLAMADO_TRIAJE')).toBe(false); // sin pagar no hay triaje
    expect(canTransition('EN_TRIAJE', 'EN_ESPERA_CONSULTA')).toBe(false); // sin cita no hay consulta
    expect(canTransition('CITADO', 'LLAMADO_CONSULTA')).toBe(false); // el citado primero registra su llegada
  });
});

describe('flujo completo del paciente', () => {
  // Lunes 12 de octubre de 2026, 09:10: Medicina General y Pediatría atienden; Cardiología no (martes y jueves)
  const NOW = new Date(2026, 9, 12, 9, 10).getTime();
  it('admisión → caja → triaje → cita → consulta → receta', () => {
    let db = buildSeed(NOW);
    const u = (x) => db.users.find((y) => y.u === x);
    const ctx = (user, area = 'Consultorio 1') => ({ user: u(user), area, now: NOW, ip: '-' });
    const step = (fn, c, ...a) => { const r = fn(db, c, ...a); db = applyChanges(db, r.changes); return r; };
    const mine = (t) => db.turns.find((x) => x.id === t.id && x.t0 === t.t0); // el código se repite en otros días

    // Sin seguro: el turno espera en Caja y no puede pasar a triaje sin pagar
    const t = step(createTurn, ctx('a.admision'), { dni: '70000099', form: { nom: 'Ana', ape: 'Prueba', nac: '1990-01-01', sexo: 'F', tel: '' }, sis: 'NO_ASEGURADO' }).result;
    expect(t.state).toBe('PENDIENTE_PAGO');
    expect(() => createTurn(db, ctx('a.admision'), { dni: '70000099', form: {}, sis: 'NO_ASEGURADO' })).toThrow(/ya tiene el turno/);
    expect(() => callTurn(db, ctx('e.triaje'), t.id)).toThrow(/no está disponible/);
    expect(() => registerPayment(db, ctx('c.caja'), t.id, { metodo: 'EFECTIVO', recibido: 10 })).toThrow(/no cubre/);
    step(registerPayment, ctx('c.caja'), t.id, { metodo: 'EFECTIVO', recibido: 50 });
    expect(mine(t).state).toBe('EN_ESPERA_TRIAJE');
    expect(mine(t).pago).toMatchObject({ metodo: 'EFECTIVO', monto: 20 });
    expect(mine(t).pago.comp).toMatch(/^B001-\d{6}$/);

    // Triaje crítico: pasa a Admisión por su cita
    for (const x of db.turns.filter((y) => y.state === 'EN_TRIAJE')) step(returnToQueue, ctx('e.triaje'), x.id);
    step(callTurn, ctx('e.triaje'), t.id);
    step(startTriage, ctx('e.triaje'), t.id);
    step(saveTriage, ctx('e.triaje'), t.id, { ...normal, spo2: 85 }, 'Penicilina');
    expect(mine(t)).toMatchObject({ prio: 'CRITICA', state: 'PENDIENTE_CITA' });

    // Crítico: sobrecupo hoy con el médico de turno (Dra. Ríos, lunes de 07:00 a 13:00)
    const sug = sugerirCita(db, 'MG', 'CRITICA', NOW);
    expect(sug.cita).toMatchObject({ med: 'm.consulta', sobre: true, at: NOW });
    step(assignCita, ctx('a.admision'), t.id, sug.cita);
    expect(mine(t)).toMatchObject({ state: 'EN_ESPERA_CONSULTA', tLlega: NOW });

    // Solo su médico lo llama
    expect(() => callTurn(db, ctx('m.consulta2'), t.id)).toThrow(/solo su médico/);
    for (const x of db.turns.filter((y) => y.state === 'EN_CONSULTA' && y.dest === 'Consultorio 1')) step(returnToQueue, ctx('m.consulta'), x.id);
    step(callTurn, ctx('m.consulta'), t.id);
    step(startConsult, ctx('m.consulta'), t.id);
    // CR-06: con la atención abierta no se llama a otro paciente
    expect(() => callNext(db, ctx('m.consulta'), 'med', () => 0)).toThrow(/Termine o devuelva la atención de/);
    const form = { notas: 'Ok', dx: [['J00', 'Resfriado', 'D']], meds: [{ n: 'Amoxicilina 500 mg', dosis: '1 cáps', frec: 'c/8 h', dias: '7', cant: '21' }], dest: 'Alta', destx: '' };
    expect(() => finishConsult(db, ctx('m.consulta'), t.id, form)).toThrow(/Alergia/);
    step(finishConsult, ctx('m.consulta'), t.id, { ...form, allergyOverride: true });

    const done = mine(t);
    expect(done.state).toBe('ATENDIDO');
    expect(done.consult.medico.n).toBe('Dra. Elena Ríos (demo)');
    expect(db.audit.some((a) => a.a === 'ALERGIA_CONFIRMADA')).toBe(true);
  });

  it('con SIS no se cobra: pasa directo a triaje', () => {
    const db = buildSeed(NOW);
    const ctx = { user: db.users.find((x) => x.u === 'a.admision'), now: NOW, ip: '-' };
    const t = createTurn(db, ctx, { dni: '70000098', form: { nom: 'Luis', ape: 'Sis', nac: '1980-01-01', sexo: 'M', tel: '' }, sis: 'ACTIVO' }).result;
    expect(t).toMatchObject({ state: 'EN_ESPERA_TRIAJE', pago: { metodo: 'SIS', monto: 0, comp: null } });
  });

  it('si el especialista no atiende hoy, la cita es otro día y la llegada se registra ese día', () => {
    let db = buildSeed(NOW);
    const u = (x) => db.users.find((y) => y.u === x);
    const step = (fn, user, now, ...a) => { const r = fn(db, { user: u(user), area: 'Consultorio 2', now, ip: '-' }, ...a); db = applyChanges(db, r.changes); return r; };
    const t = step(createTurn, 'a.admision', NOW, { dni: '70000097', form: { nom: 'Juan', ape: 'Cardio', nac: '1960-01-01', sexo: 'M', tel: '' }, sis: 'ACTIVO' }).result;
    for (const x of db.turns.filter((y) => y.state === 'EN_TRIAJE')) step(returnToQueue, 'e.triaje', NOW, x.id);
    step(callTurn, 'e.triaje', NOW, t.id);
    step(startTriage, 'e.triaje', NOW, t.id);
    step(saveTriage, 'e.triaje', NOW, t.id, { ...normal, motivo: 'Control de presión arterial' }, '');
    const cur = db.turns.find((x) => x.id === t.id && x.t0 === t.t0);
    const patient = db.patients.find((p) => p.dni === '70000097');
    expect(especialidadSugerida(patient, cur.tri, NOW)).toBe('CAR');

    const sug = sugerirCita(db, 'CAR', cur.prio, NOW);
    expect(sug.motivo).toBe('otro-dia');
    expect([2, 4]).toContain(isoDow(sug.cita.at)); // martes o jueves
    expect(() => assignCita(db, { user: u('a.admision'), now: NOW }, t.id, { ...sug.cita, at: NOW + 60 * 60_000 })).toThrow(/no atiende los lunes/);
    step(assignCita, 'a.admision', NOW, t.id, sug.cita);
    const citado = () => db.turns.find((x) => x.id === t.id && x.t0 === t.t0);
    expect(citado().state).toBe('CITADO');

    // Hoy no se puede registrar su llegada; el día de la cita sí
    expect(() => checkIn(db, { user: u('a.admision'), now: NOW }, t.id)).toThrow(/mismo día de la cita/);
    const arrive = sug.cita.at - 10 * 60_000;
    step(checkIn, 'a.admision', arrive, t.id);
    expect(citado()).toMatchObject({ state: 'EN_ESPERA_CONSULTA', llego: arrive, tLlega: sug.cita.at });
    expect(() => callTurn(db, { user: u('m.consulta'), area: 'Consultorio 1', now: arrive }, t.id)).toThrow(/solo su médico/);
  });

  it('prioritario: si la especialidad no atiende hoy, se propone Medicina General hoy', () => {
    const db = buildSeed(NOW);
    const s = sugerirCita(db, 'CAR', 'PRIORITARIA', NOW);
    expect(s.motivo).toBe('mg-hoy');
    expect(s.cita.esp).toBe('MG');
    expect(new Date(s.cita.at).toDateString()).toBe(new Date(NOW).toDateString());
  });

  it('no permite que un usuario se desactive a sí mismo', () => {
    const db = buildSeed();
    const ctx = { user: db.users.find((x) => x.u === 'j.jefatura'), now: Date.now() };
    expect(() => toggleUser(db, ctx, 'j.jefatura')).toThrow();
  });
});
