import { describe, it, expect } from 'vitest';
import {
  evalTriage, validateVitals, validateThresholds, allergyConflicts, canTransition, byPriority, calcIMC,
} from '../clinical.js';
import { TH_DEFAULT } from '../constants.js';
import { nextTurnId, nextRecipe, nextHC } from '../ids.js';
import { buildSeed } from '../seed.js';
import { createTurn, callTurn, startTriage, saveTriage, startConsult, finishConsult, toggleUser } from '../../store/actions.js';
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
  it('genera el siguiente correlativo a partir de los datos', () => {
    const db = buildSeed();
    expect(nextTurnId(db.turns)).toBe('TR-048');
    expect(nextRecipe(db.turns, 2026)).toBe('REC-2026-000412');
    expect(nextHC(db.patients)).toBe('HC-000107');
  });
  it('no permite saltar etapas', () => {
    expect(canTransition('EN_ESPERA_TRIAJE', 'EN_CONSULTA')).toBe(false);
    expect(canTransition('ATENDIDO', 'CANCELADO')).toBe(false);
  });
});

describe('flujo completo del paciente', () => {
  it('admisión → triaje → consulta → receta', () => {
    let db = buildSeed();
    const u = (x) => db.users.find((y) => y.u === x);
    const ctx = (user, area = 'Consultorio 2') => ({ user: u(user), area, now: Date.now(), ip: '-' });
    const step = (fn, c, ...a) => { const r = fn(db, c, ...a); db = applyChanges(db, r.changes); return r; };

    const t = step(createTurn, ctx('a.admision'), { dni: '70000099', form: { nom: 'Ana', ape: 'Prueba', nac: '1990-01-01', sexo: 'F', tel: '' }, sis: 'ACTIVO' }).result;
    expect(() => createTurn(db, ctx('a.admision'), { dni: '70000099', form: {}, sis: 'ACTIVO' })).toThrow(/ya tiene el turno/);

    step(callTurn, ctx('e.triaje'), t.id);
    step(startTriage, ctx('e.triaje'), t.id);
    step(saveTriage, ctx('e.triaje'), t.id, { ...normal, spo2: 85 }, 'Penicilina');
    expect(db.turns.find((x) => x.id === t.id).prio).toBe('CRITICA');

    step(callTurn, ctx('m.consulta2'), t.id);
    step(startConsult, ctx('m.consulta2'), t.id);
    const form = { notas: 'Ok', dx: [['J00', 'Resfriado', 'D']], meds: [{ n: 'Amoxicilina 500 mg', dosis: '1 cáps', frec: 'c/8 h', dias: '7', cant: '21' }], dest: 'Alta', destx: '' };
    expect(() => finishConsult(db, ctx('m.consulta2'), t.id, form)).toThrow(/Alergia/);
    step(finishConsult, ctx('m.consulta2'), t.id, { ...form, allergyOverride: true });

    const done = db.turns.find((x) => x.id === t.id);
    expect(done.state).toBe('ATENDIDO');
    expect(done.consult.medico.n).toBe('Dr. Luis Paz (demo)');
    expect(db.audit.some((a) => a.a === 'ALERGIA_CONFIRMADA')).toBe(true);
  });

  it('no permite que un usuario se desactive a sí mismo', () => {
    const db = buildSeed();
    const ctx = { user: db.users.find((x) => x.u === 'j.jefatura'), now: Date.now() };
    expect(() => toggleUser(db, ctx, 'j.jefatura')).toThrow();
  });
});
