import { describe, it, expect } from 'vitest';
import { tempPassword } from '../ids.js';
import { PASSWORD_RULE, ROLES } from '../constants.js';
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

  it('las contraseñas temporales nunca quedan en el estado local', () => {
    const db = buildSeed();
    const r = createUser(db, ctx(db), { u: 'm.nuevo', n: 'Dra. Ana Gil', role: 'med', col: 'CMP-12345' });
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
