import { describe, it, expect } from 'vitest';
import { crearSandbox, relojInicial } from '../simulacion.js';
import { simularHoraPunta } from '../horaPunta.js';

// Lunes 12 de octubre de 2026: la hora punta empieza a las 8:00
const reloj = relojInicial(new Date(2026, 9, 12, 7, 0).getTime());
const base = crearSandbox(reloj);
const h = simularHoraPunta(base, reloj, { pacientes: 20 });
const final = h.fotos.at(-1).db.turns.filter((t) => t.t0 >= reloj);

describe('hora punta', () => {
  it('llegan todos en la primera hora y las reglas no rechazan ninguna acción', () => {
    expect(h.llegadas).toBe(20);
    expect(final).toHaveLength(20);
    expect(final.every((t) => t.t0 < reloj + 60 * 60_000)).toBe(true);
    expect(h.errores).toBe(0);
  });

  it('nadie queda a medias: cada paciente termina atendido o con cita para otro día', () => {
    expect(final.every((t) => ['ATENDIDO', 'CITADO'].includes(t.state))).toBe(true);
    expect(h.resumen.atendidos + h.resumen.citadosOtroDia).toBe(20);
  });

  it('cada módulo de triaje atiende de uno en uno, varios a la vez, y los no asegurados pagan antes', () => {
    let maxModulos = 0;
    for (const f of h.fotos) {
      const enTriaje = f.db.turns.filter((t) => t.state === 'EN_TRIAJE');
      expect(new Set(enTriaje.map((t) => t.dest)).size).toBe(enTriaje.length);
      maxModulos = Math.max(maxModulos, enTriaje.length);
    }
    expect(maxModulos).toBeGreaterThan(1);
    const pagan = final.filter((t) => t.pago && t.pago.metodo !== 'SIS');
    expect(pagan.every((t) => t.tPago <= t.tTriCall)).toBe(true);
  });

  it('se repite igual con la misma semilla', () => {
    const otra = simularHoraPunta(base, reloj, { pacientes: 20 });
    expect(otra.fotos.length).toBe(h.fotos.length);
    expect(otra.resumen.esperaMedia).toBe(h.resumen.esperaMedia);
  });
});
