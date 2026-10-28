import { describe, it, expect } from 'vitest';
import { tempPassword } from '../ids.js';
import { PASSWORD_RULE, ROLES, roleFromUsername } from '../constants.js';
import { applyChanges } from '../../data/merge.js';
import { buildSeed } from '../seed.js';
import { createUser, resetPassword } from '../../store/actions.js';

const ctx = (db) => ({ user: db.users.find((x) => x.u === 'j.jefatura'), area: 'Consultorio 1', now: Date.now(), ip: '' });

describe('seguridad', () => {
  it('la contraseña temporal cumple la política y no se repite', () => {
    const set = new Set(Array.from({ length: 200 }, tempPassword));
    expect(set.size).toBe(200);
    set.forEach((p) => expect(PASSWORD_RULE.re.test(p)).toBe(true));
  });

  it('un médico se crea con su especialidad', () => {
    const db = buildSeed();
    expect(() => createUser(db, ctx(db), { u: 'm.otro', n: 'Dr. Sin Especialidad', role: 'med', col: 'CMP-12346' })).toThrow(/especialidad/);
  });

  it('el usuario lleva el prefijo de su rol, que el inicio de sesión usa para reconocer el área', () => {
    const db = buildSeed();
    expect(() => createUser(db, ctx(db), { u: 'ana.gil', n: 'Ana Gil', role: 'caj', col: '' })).toThrow(/empieza con «c\.»/);
    expect(() => createUser(db, ctx(db), { u: 'c.', n: 'Ana Gil', role: 'caj', col: '' })).toThrow(/4 a 20/);
    expect(createUser(db, ctx(db), { u: 'c.gil', n: 'Ana Gil', role: 'caj', col: '' }).result.u).toBe('c.gil');
    expect(db.users.every((x) => roleFromUsername(x.u) === x.role)).toBe(true);
    expect(roleFromUsername(' M.Cardio ')).toBe('med');
    expect(roleFromUsername('x.otro')).toBeNull();
  });

  it('la colegiatura corresponde a la profesión de la especialidad', () => {
    const db = buildSeed();
    const nuevo = (esp, col) => createUser(db, ctx(db), { u: 'm.nuevo', n: 'Ana Gil', role: 'med', col, esp });
    expect(() => nuevo('ODO', 'CMP-12345')).toThrow(/COP-00000/);
    expect(nuevo('ODO', 'COP-12345').result.u).toBe('m.nuevo');
    expect(nuevo('PSI', 'CPsP-12345').result.u).toBe('m.nuevo');
    expect(nuevo('CRED', 'CEP-12345').result.u).toBe('m.nuevo');
    expect(() => nuevo('MG', 'CNP-12345')).toThrow(/CMP-00000/);
  });

  it('las contraseñas temporales nunca quedan en el estado local', () => {
    const db = buildSeed();
    const r = createUser(db, ctx(db), { u: 'm.nuevo', n: 'Dra. Ana Gil', role: 'med', col: 'CMP-12345', esp: 'MG' });
    expect(r.result.clave).toMatch(PASSWORD_RULE.re);
    const next = applyChanges(db, r.changes);
    expect(JSON.stringify(next)).not.toContain(r.result.clave);
    const r2 = resetPassword(next, ctx(next), 'm.nuevo');
    expect(JSON.stringify(applyChanges(next, r2.changes))).not.toContain(r2.result.clave);
  });

  it('cada rol tiene su propio espacio con dirección única', () => {
    const slugs = Object.values(ROLES).map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain('sala');
  });
});
