import { describe, it, expect } from 'vitest';
import { buildSeed } from '../seed.js';
import { TRIAGE_MODULES, moduloTriaje, modulosTriaje } from '../constants.js';
import { estimarEsperas } from '../espera.js';
import { callTurn, startTriage } from '../../store/actions.js';
import { applyChanges } from '../../data/merge.js';
import { turnKey } from '../clinical.js';

// Lunes 12 de octubre de 2026, 09:10
const NOW = new Date(2026, 9, 12, 9, 10).getTime();
const seed = buildSeed(NOW);
const ctxDe = (db, u) => ({ user: db.users.find((x) => x.u === u), area: moduloTriaje(db.users, u), now: NOW, ip: '' });
const aplicar = (db, accion, u, ...args) => applyChanges(db, accion(db, ctxDe(db, u), ...args).changes);

describe('varios módulos de triaje', () => {
  it('cada enfermera activa tiene su módulo y la cola tiene tantos puestos como enfermeras', () => {
    const activas = seed.users.filter((u) => u.role === 'enf' && u.on).map((u) => u.u).sort();
    expect(activas.map((u) => moduloTriaje(seed.users, u))).toEqual(TRIAGE_MODULES.slice(0, activas.length));
    expect(modulosTriaje(seed.users)).toBe(activas.length);
    expect(moduloTriaje(seed.users, activas[0], 'Módulo de Triaje 4')).toBe('Módulo de Triaje 4');
  });

  it('dos enfermeras atienden a la vez en sus módulos, pero un módulo no toma a dos pacientes', () => {
    // Se libera el triaje del día para empezar con los módulos vacíos
    let db = { ...seed, turns: seed.turns.map((t) => (['LLAMADO_TRIAJE', 'EN_TRIAJE'].includes(t.state) ? { ...t, state: 'EN_ESPERA_TRIAJE', dest: null } : t)) };
    const cola = db.turns.filter((t) => t.state === 'EN_ESPERA_TRIAJE');
    expect(cola.length).toBeGreaterThanOrEqual(2);
    const [a, b] = cola;
    db = aplicar(db, callTurn, 'e.triaje', a.id);
    db = aplicar(db, startTriage, 'e.triaje', a.id);
    // El módulo 1 ya tiene a su paciente: no puede llamar a otro
    expect(() => callTurn(db, ctxDe(db, 'e.triaje'), b.id)).toThrow(/Termine o devuelva/);
    // Otra enfermera sí lo llama a su módulo, y desde un tercer módulo ya no se puede volver a llamar
    db = aplicar(db, callTurn, 'e.triaje3', b.id);
    expect(() => callTurn(db, ctxDe(db, 'e.triaje2'), b.id)).toThrow(/ya fue llamado a Módulo de Triaje 3/);
    db = aplicar(db, startTriage, 'e.triaje3', b.id);
    const enTriaje = db.turns.filter((t) => t.state === 'EN_TRIAJE');
    expect(enTriaje.map((t) => t.dest).sort()).toEqual(['Módulo de Triaje 1', 'Módulo de Triaje 3']);
  });

  it('la espera de triaje se reparte entre los módulos', () => {
    const t = seed.turns;
    const uno = estimarEsperas(t, NOW);
    const tres = estimarEsperas(t, NOW, { modulos: 3 });
    const ult = t.filter((x) => x.state === 'EN_ESPERA_TRIAJE').at(-1);
    expect(tres.get(turnKey(ult))).toBeLessThan(uno.get(turnKey(ult)));
  });
});
