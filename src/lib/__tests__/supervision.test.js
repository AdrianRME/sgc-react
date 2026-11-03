import { describe, it, expect } from 'vitest';
import { byConsulta, byTriaje, preferenteDe, waitInfo } from '../clinical.js';
import { MIN } from '../constants.js';
import { buildSeed } from '../seed.js';
import { escalaciones, escalacionesPara } from '../supervision.js';
import { toFacts } from '../analytics.js';
import {
  createTurn, registerLatePayment, porCobrarDespues, callNext, accesoJustificado, atiendeA,
} from '../../store/actions.js';
import { applyChanges } from '../../data/merge.js';

// Lunes 12 de octubre de 2026, 09:10
const NOW = new Date(2026, 9, 12, 9, 10).getTime();
const nuevo = (nac, sexo = 'F') => ({ nom: 'Ana', ape: 'Prueba', nac, sexo, tel: '' });

function mundo() {
  let db = buildSeed(NOW);
  const u = (x) => db.users.find((y) => y.u === x);
  const ctx = (user, now = NOW) => ({ user: u(user), area: 'Consultorio 1', now, ip: '-' });
  const step = (fn, c, ...a) => { const r = fn(db, c, ...a); db = applyChanges(db, r.changes); return r; };
  return { get db() { return db; }, ctx, step };
}

describe('urgencia sin cobro previo', () => {
  it('un paciente sin seguro con signo de alarma pasa a triaje sin pagar y paga después', () => {
    const w = mundo();
    const t = w.step(createTurn, w.ctx('a.admision'), {
      dni: '70000091', form: nuevo('1990-01-01'), sis: 'NO_ASEGURADO', urg: 'Dificultad para respirar',
    }).result;
    expect(t.state).toBe('EN_ESPERA_TRIAJE');
    expect(t.pago).toBeUndefined();
    expect(porCobrarDespues(t)).toBe(true);
    expect(w.db.audit.some((a) => a.a === 'URGENCIA' && a.d.includes('sin cobro previo'))).toBe(true);

    const paid = w.step(registerLatePayment, w.ctx('c.caja'), t.id, { metodo: 'TARJETA' }).result;
    expect(paid.state).toBe('EN_ESPERA_TRIAJE'); // el cobro no cambia su lugar en la atención
    expect(paid.pago.comp).toMatch(/^B001-\d{6}$/);
    expect(porCobrarDespues(paid)).toBe(false);
  });

  it('rechaza un signo de alarma que no está en la lista', () => {
    const w = mundo();
    expect(() => createTurn(w.db, w.ctx('a.admision'), { dni: '70000092', form: nuevo('1990-01-01'), sis: 'NO_ASEGURADO', urg: 'Otro' }))
      .toThrow(/signo de alarma/);
  });

  it('la urgencia pasa primero en la cola de triaje', () => {
    const a = { id: 'A', t0: 1 };
    const b = { id: 'B', t0: 2, urg: 'Dolor de pecho' };
    expect([a, b].sort(byTriaje).map((x) => x.id)).toEqual(['B', 'A']);
  });

  it('en los indicadores, la urgencia no suma espera de pago', () => {
    const f = toFacts([{ id: 'X', dni: '1', state: 'ATENDIDO', t0: 0, urg: 'Dolor intenso', tTriCall: 4 * MIN, tPago: 60 * MIN }], []);
    expect(f[0].dur.espPago).toBe(0);
    expect(f[0].dur.espTri).toBe(4);
  });
});

describe('atención preferente (Ley N.° 27408)', () => {
  it('la marca el sistema por edad: adulto mayor y niño', () => {
    expect(preferenteDe({ nac: '1950-05-01' }, null, NOW)).toBe('ADULTO_MAYOR');
    expect(preferenteDe({ nac: '2020-05-01' }, null, NOW)).toBe('NINO');
    expect(preferenteDe({ nac: '1990-05-01' }, null, NOW)).toBeNull();
    expect(preferenteDe({ nac: '1990-05-01' }, 'GESTANTE', NOW)).toBe('GESTANTE');
  });

  it('a igual prioridad pasa primero; una prioridad más grave sigue yendo antes', () => {
    const normal = { id: 'N', prio: 'NORMAL', t0: 1 };
    const pref = { id: 'P', prio: 'NORMAL', t0: 5, pref: 'ADULTO_MAYOR' };
    const crit = { id: 'C', prio: 'CRITICA', t0: 9 };
    expect([normal, pref, crit].sort(byConsulta).map((x) => x.id)).toEqual(['C', 'P', 'N']);
  });

  it('solo una mujer puede registrarse como gestante', () => {
    const w = mundo();
    expect(() => createTurn(w.db, w.ctx('a.admision'), { dni: '70000093', form: nuevo('1990-01-01', 'M'), sis: 'ACTIVO', pref: 'GESTANTE' }))
      .toThrow(/gestante/);
    const t = w.step(createTurn, w.ctx('a.admision'), { dni: '70000094', form: nuevo('1990-01-01'), sis: 'ACTIVO', pref: 'GESTANTE' }).result;
    expect(t.pref).toBe('GESTANTE');
  });

  it('Enfermería llama primero a la urgencia y luego a la atención preferente', () => {
    const w = mundo();
    w.db.turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE').forEach((t) => { t.state = 'CANCELADO'; });
    const a = w.step(createTurn, w.ctx('a.admision', NOW), { dni: '70000095', form: nuevo('1990-01-01'), sis: 'ACTIVO' }).result;
    const m = w.step(createTurn, w.ctx('a.admision', NOW + MIN), { dni: '70000096', form: nuevo('1950-01-01'), sis: 'ACTIVO' }).result;
    const u = w.step(createTurn, w.ctx('a.admision', NOW + 2 * MIN), { dni: '70000097', form: nuevo('1990-01-01'), sis: 'ACTIVO', urg: 'Dolor de pecho' }).result;
    expect(m.pref).toBe('ADULTO_MAYOR');
    const orden = [a, m, u].sort(byTriaje).map((t) => t.id);
    expect(orden).toEqual([u.id, m.id, a.id]);
    w.step(callNext, w.ctx('e.triaje', NOW + 3 * MIN), 'tri', byTriaje);
    expect(w.db.turns.find((t) => t.id === u.id && t.t0 === u.t0).state).toBe('LLAMADO_TRIAJE');
  });
});

describe('escalada de pacientes sensibles', () => {
  const T = (x) => ({ id: 'TR-900', dni: '1', t0: NOW - 30 * MIN, ...x });

  it('avisa si una urgencia espera triaje más de 5 minutos', () => {
    const t = T({ state: 'EN_ESPERA_TRIAJE', urg: 'Dolor de pecho', t0: NOW - 7 * MIN });
    expect(waitInfo(t, NOW).target).toBe(5);
    const [x] = escalaciones([t], NOW);
    expect(x.k).toBe('urgencia');
    expect(x.para).toContain('enf');
  });

  it('avisa si un crítico sigue sin sobrecupo y no avisa antes del objetivo', () => {
    const t = T({ state: 'PENDIENTE_CITA', prio: 'CRITICA', tTriSave: NOW - 8 * MIN });
    expect(escalaciones([t], NOW)[0].k).toBe('sobrecupo');
    expect(escalaciones([{ ...t, tTriSave: NOW - 2 * MIN }], NOW)).toEqual([]);
  });

  it('el aviso de consulta le llega solo al médico de la cita y a Jefatura', () => {
    const t = T({ state: 'EN_ESPERA_CONSULTA', prio: 'CRITICA', tLlega: NOW - 9 * MIN, cita: { med: 'm.consulta' } });
    const lista = escalaciones([t], NOW);
    expect(escalacionesPara(lista, { role: 'med', u: 'm.consulta' })).toHaveLength(1);
    expect(escalacionesPara(lista, { role: 'med', u: 'm.consulta2' })).toHaveLength(0);
    expect(escalacionesPara(lista, { role: 'jef', u: 'j.jefatura' })).toHaveLength(1);
    expect(escalacionesPara(lista, { role: 'adm', u: 'a.admision' })).toHaveLength(0);
  });

  it('un paciente normal dentro de su objetivo no genera alertas', () => {
    expect(escalaciones([T({ state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', tLlega: NOW - 30 * MIN })], NOW)).toEqual([]);
  });
});

describe('acceso justificado a la historia clínica', () => {
  it('pide motivo si el médico no atiende al paciente y lo deja en la auditoría', () => {
    const w = mundo();
    const p = w.db.patients[0];
    expect(atiendeA(w.db, 'm.psicologia', p.dni)).toBe(false);
    expect(() => accesoJustificado(w.db, w.ctx('m.psicologia'), p.dni, '')).toThrow(/motivo/);
    w.step(accesoJustificado, w.ctx('m.psicologia'), p.dni, 'Urgencia o emergencia del paciente');
    const a = w.db.audit.find((x) => x.a === 'HC_CONSULTADA' && x.d.includes('acceso justificado'));
    expect(a?.d).toContain(p.hc);
  });
});
