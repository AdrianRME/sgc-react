import { describe, it, expect } from 'vitest';
import { buildSeed } from '../seed.js';
import { toFacts, summarize, periodOf, series, heatmap, topDx, cumplimiento, slice, delta, toCSV, grupoEdad } from '../analytics.js';
import { evalTriage } from '../clinical.js';
import { TH_DEFAULT, DAY, ACTIVE_STATES } from '../constants.js';
import { diffEvents } from '../activity.js';
import { applyChanges } from '../../data/merge.js';
import { callTurn, startTriage, saveTriage } from '../../store/actions.js';

const NOW = new Date(2026, 8, 30, 15, 40).getTime();
const seed = buildSeed(NOW);

describe('semilla de demostración', () => {
  it('es determinista', () => {
    expect(JSON.stringify(buildSeed(NOW))).toBe(JSON.stringify(seed));
  });
  it('la prioridad de cada turno coincide con la regla de triaje', () => {
    seed.turns.filter((t) => t.tri && t.prio).forEach((t) => expect(evalTriage(t.tri, TH_DEFAULT).prio, t.id).toBe(t.prio));
  });
  it('códigos de turno únicos por día y recetas únicas', () => {
    const keys = seed.turns.map((t) => `${new Date(t.t0).toDateString()}|${t.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    const recs = seed.turns.filter((t) => t.consult).map((t) => t.consult.rec);
    expect(new Set(recs).size).toBe(recs.length);
  });
  it('ningún paciente tiene dos turnos abiertos ni recetas que choquen con sus alergias registradas', () => {
    const open = seed.turns.filter((t) => ACTIVE_STATES.includes(t.state)).map((t) => t.dni);
    expect(new Set(open).size).toBe(open.length);
    const alg = new Map(seed.patients.map((p) => [p.dni, p.alg]));
    seed.turns.filter((t) => t.consult && alg.get(t.dni) === 'Penicilina')
      .forEach((t) => expect(t.consult.meds.map((m) => m.n)).not.toContain('Amoxicilina 500 mg'));
  });
});

describe('indicadores de gestión', () => {
  const facts = toFacts(seed.turns, seed.patients);
  it('los hechos no contienen datos personales', () => {
    const keys = new Set(facts.flatMap(Object.keys));
    ['dni', 'nom', 'ape', 'hc', 'tri', 'consult'].forEach((k) => expect(keys.has(k)).toBe(false));
  });
  it('el periodo actual y el de comparación terminan a la misma hora relativa', () => {
    const p = periodOf('7d', NOW);
    expect(p.to - p.prevTo).toBe(7 * DAY);
    expect(p.from - p.prevFrom).toBe(7 * DAY);
    const h = periodOf('hoy', NOW);
    expect(h.to - h.prevTo).toBe(7 * DAY); // mismo día de la semana pasada
  });
  it('resume atendidos, cancelados y cumplimiento sin contar dos veces', () => {
    const p = periodOf('28d', NOW);
    const cur = slice(facts, p.from, p.to);
    const s = summarize(cur);
    expect(s.atendidos + s.cancelados + cur.filter((f) => ACTIVE_STATES.includes(f.state)).length).toBe(s.n);
    expect(s.enObjetivo).toBeGreaterThan(0.5);
    expect(s.enObjetivo).toBeLessThanOrEqual(1);
    const c = cumplimiento(cur);
    expect(c.map((x) => x.prio)).toEqual(['CRITICA', 'PRIORITARIA', 'NORMAL']);
  });
  it('la serie diaria suma el total del periodo y omite domingos sin atención', () => {
    const p = periodOf('14d', NOW);
    const cur = slice(facts, p.from, p.to);
    const days = series(cur, p.from, p.to);
    expect(days.reduce((a, d) => a + d.total, 0)).toBe(cur.length);
    expect(days.some((d) => new Date(d.t).getDay() === 0)).toBe(false);
    expect(series(cur, p.from, p.to, true)).toHaveLength(11); // 7 a 17 h
  });
  it('el mapa de calor promedia por día de la semana y hora', () => {
    const p = periodOf('28d', NOW);
    const hm = heatmap(slice(facts, p.from, p.to), p.from, p.to);
    expect(hm.cells).toHaveLength(6);
    expect(hm.cells[0]).toHaveLength(10);
    expect(hm.max).toBeGreaterThan(0);
  });
  it('morbilidad ordenada de mayor a menor y etapas de vida del MINSA', () => {
    const dx = topDx(facts);
    expect(dx[0].n).toBeGreaterThanOrEqual(dx[dx.length - 1].n);
    expect([grupoEdad(5), grupoEdad(15), grupoEdad(25), grupoEdad(45), grupoEdad(70)]).toEqual(['nino', 'adolescente', 'joven', 'adulto', 'mayor']);
  });
  it('variación y CSV', () => {
    expect(delta(120, 100)).toBeCloseTo(0.2);
    expect(delta(5, 0)).toBeNull();
    const csv = toCSV([['a', 'Día'], ['b', 'Valor; con punto y coma']], [{ a: 'lun', b: 'x"y' }]);
    expect(csv.startsWith('﻿Día;"Valor; con punto y coma"')).toBe(true);
    expect(csv).toContain('lun;"x""y"');
  });
});

describe('persistencia local', () => {
  it('actualizar un turno no pisa los de otros días con el mismo código', () => {
    const t = seed.turns.find((x) => x.state === 'LLAMADO_CONSULTA');
    const next = applyChanges(seed, { turns: [{ ...t, state: 'EN_CONSULTA' }] });
    expect(next.turns).toHaveLength(seed.turns.length);
    expect(next.turns.filter((x) => x.id === t.id).length).toBeGreaterThan(1);
    expect(next.turns.find((x) => x.id === t.id && x.t0 === t.t0).state).toBe('EN_CONSULTA');
  });
});

describe('centro de notificaciones', () => {
  it('avisa al médico de un triaje crítico hecho por otra persona, no de lo propio', () => {
    let db = { ...seed, turns: seed.turns.filter((t) => t.t0 >= NOW - DAY) };
    const u = (x) => db.users.find((y) => y.u === x);
    const t = db.turns.find((x) => x.state === 'EN_ESPERA_TRIAJE');
    const ctx = { user: u('e.triaje'), area: 'Consultorio 1', now: NOW, ip: '' };
    db = applyChanges(db, callTurn(db, ctx, t.id).changes);
    db = applyChanges(db, startTriage(db, ctx, t.id).changes);
    const before = db;
    const vit = { pa: '120/80', fc: 80, fr: 18, t: 36.8, spo2: 86, peso: 60, talla: 1.6, motivo: 'Disnea' };
    db = applyChanges(db, saveTriage(db, ctx, t.id, vit, '').changes);
    const med = diffEvents(before, db, u('m.consulta'));
    expect(med.some((e) => e.tone === 'crit' && e.text.includes(t.id))).toBe(true);
    expect(diffEvents(before, db, u('e.triaje'))).toEqual([]);
  });
});
