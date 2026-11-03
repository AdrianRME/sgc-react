import { describe, it, expect } from 'vitest';
import { entrenarBosque, mae, modeloAfluencia, modeloEspera } from '../ml.js';
import { buildSeed } from '../seed.js';
import { toFacts } from '../analytics.js';

// Lunes 12 de octubre de 2026, 10:00
const NOW = new Date(2026, 9, 12, 10, 0).getTime();
const seed = buildSeed(NOW);
const facts = toFacts(seed.turns, seed.patients);

describe('bosque aleatorio', () => {
  // y depende solo de la primera variable (un escalón); la segunda es ruido
  const X = Array.from({ length: 200 }, (_, i) => [i % 20, (i * 7) % 13]);
  const y = X.map(([a]) => (a < 10 ? 5 : 30));

  it('aprende una regla simple y la variable que importa', () => {
    const m = entrenarBosque(X, y);
    // Algunos árboles cortan por la variable de ruido (cada corte ve solo una variable): el promedio se acerca, no clava
    expect(Math.abs(m.predecir([3, 0]) - 5)).toBeLessThan(3);
    expect(Math.abs(m.predecir([15, 0]) - 30)).toBeLessThan(3);
    expect(m.importancia[0]).toBeGreaterThan(0.8);
    expect(mae(X.map((x) => m.predecir(x)), y)).toBeLessThan(3);
  });

  it('con la misma semilla entrena el mismo modelo', () => {
    const a = entrenarBosque(X, y, { seed: 3 });
    const b = entrenarBosque(X, y, { seed: 3 });
    expect(a.predecir([9.5, 4])).toBe(b.predecir([9.5, 4]));
  });

  it('sin datos no hay modelo', () => {
    expect(entrenarBosque([], [])).toBeNull();
  });
});

describe('caso 1: espera del paciente', () => {
  const m = modeloEspera(facts, NOW);

  it('se evalúa en la última semana, con datos que no vio', () => {
    expect(m.n.train).toBeGreaterThan(100);
    expect(m.n.test).toBeGreaterThan(10);
    expect(m.puntos).toHaveLength(m.n.test);
    expect(Number.isFinite(m.mae) && Number.isFinite(m.maeBase)).toBe(true);
  });

  it('la prioridad es lo que más pesa y un crítico espera menos que un normal', () => {
    expect(m.importancia[0].n).toBe('Prioridad');
    const t0 = new Date(2026, 9, 12, 9, 0).getTime();
    const critico = m.predecir({ prio: 'CRITICA', paga: false, t0 }, 5);
    const normal = m.predecir({ prio: 'NORMAL', paga: true, t0 }, 5);
    expect(critico).toBeLessThan(normal);
  });

  it('sin semanas suficientes no entrena', () => {
    expect(modeloEspera(facts.slice(0, 20), NOW)).toBeNull();
  });
});

describe('caso 2: afluencia por hora', () => {
  const m = modeloAfluencia(facts, NOW);

  it('prevé los próximos 6 días de atención, sin domingos', () => {
    expect(m.proximos).toHaveLength(6);
    expect(m.proximos.every((d) => new Date(d.t).getDay() !== 0)).toBe(true);
    expect(m.proximos.every((d) => d.ml.length === 10 && d.ml.every((x) => x >= 0))).toBe(true);
  });

  it('compara su error con el promedio de 4 semanas', () => {
    expect(Number.isFinite(m.mae) && Number.isFinite(m.maeBase)).toBe(true);
    expect(m.n.test).toBeGreaterThan(0);
  });
});
