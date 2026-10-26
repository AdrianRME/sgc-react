import { describe, it, expect } from 'vitest';
import { MIN } from '../constants.js';
import { turnKey } from '../clinical.js';
import { estimarEsperas, rangoEspera, tiemposMedios, TRIAJE_REF_MIN } from '../espera.js';

// Lunes 12 de octubre de 2026, 10:00
const NOW = new Date(2026, 9, 12, 10, 0).getTime();
const at = (min) => NOW + min * MIN;
const cita = (med, min, esp = 'MG') => ({ esp, med, area: 'Consultorio 1', at: at(min), sobre: false });
const est = (turns) => {
  const e = estimarEsperas(turns, NOW);
  return Object.fromEntries(turns.filter((t) => e.has(turnKey(t))).map((t) => [t.id, e.get(turnKey(t))]));
};

/** Triajes terminados hoy, de `dur` minutos cada uno. */
const triajes = (n, dur) => Array.from({ length: n }, (_, i) => ({
  id: `TR-T${i}`, t0: at(-120 + i * 10), state: 'PENDIENTE_CITA', tTriCall: at(-100 + i * 10), tTriSave: at(-100 + i * 10 + dur),
}));
const consultas = (n, dur, med) => Array.from({ length: n }, (_, i) => ({
  id: `TR-C${med}${i}`, t0: at(-200 + i * 20), state: 'ATENDIDO', cita: cita(med, -150 + i * 20), tMedCall: at(-150 + i * 20), tEnd: at(-150 + i * 20 + dur),
  consult: { medico: { u: med } },
}));

describe('espera aproximada (RF-14)', () => {
  it('sin atenciones previas usa la referencia: 7 min de triaje y la duración del cupo en consulta', () => {
    expect(tiemposMedios([], NOW).tri).toBe(TRIAJE_REF_MIN);
    expect(tiemposMedios([], NOW).med('m.cardio', 'CAR')).toBe(30);
  });

  it('el promedio móvil usa solo las últimas 20 atenciones del día', () => {
    const viejos = triajes(10, 20).map((t, i) => ({ ...t, id: `TR-V${i}`, tTriCall: at(-400 + i * 25), tTriSave: at(-380 + i * 25) }));
    const recientes = triajes(20, 5).map((t, i) => ({ ...t, id: `TR-R${i}`, tTriCall: at(-60 + i), tTriSave: at(-55 + i) }));
    expect(tiemposMedios([...viejos, ...recientes], NOW).tri).toBe(5);
  });

  it('en triaje: resto del paciente en atención + turnos por delante × tiempo medio, por orden de llegada', () => {
    const turns = [
      ...triajes(4, 6),
      { id: 'TR-010', t0: at(-30), state: 'EN_TRIAJE', tTriCall: at(-2) },
      { id: 'TR-012', t0: at(-10), state: 'EN_ESPERA_TRIAJE' },
      { id: 'TR-011', t0: at(-20), state: 'EN_ESPERA_TRIAJE' },
    ];
    // tiempo medio 6; al paciente en triaje le faltan 6 − 2 = 4
    expect(est(turns)).toEqual({ 'TR-011': 4, 'TR-012': 10 });
  });

  it('en consulta, cada médico tiene su cola; el crítico pasa primero y nadie pasa antes de su cita', () => {
    const turns = [
      ...consultas(3, 12, 'm.consulta'),
      { id: 'TR-020', t0: at(-90), state: 'EN_CONSULTA', cita: cita('m.consulta', -10), tMedCall: at(-5) },
      { id: 'TR-021', t0: at(-80), state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', cita: cita('m.consulta', -20), tLlega: at(-20) },
      { id: 'TR-022', t0: at(-70), state: 'EN_ESPERA_CONSULTA', prio: 'CRITICA', cita: { ...cita('m.consulta', -2), sobre: true }, tLlega: at(-2) },
      { id: 'TR-023', t0: at(-60), state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', cita: cita('m.consulta', 60), tLlega: at(60) },
      // Otro médico, sin atenciones hoy: referencia de Cardiología (30 min)
      { id: 'TR-030', t0: at(-50), state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', cita: cita('m.cardio', 0, 'CAR'), tLlega: at(0) },
      { id: 'TR-031', t0: at(-40), state: 'EN_ESPERA_CONSULTA', prio: 'NORMAL', cita: cita('m.cardio', 0, 'CAR'), tLlega: at(0) },
    ];
    // m.consulta: media 12, faltan 7 de la atención en curso
    expect(est(turns)).toEqual({ 'TR-022': 7, 'TR-021': 19, 'TR-023': 60, 'TR-030': 0, 'TR-031': 30 });
  });

  it('no estima a quien no está en una cola de triaje o consulta', () => {
    const turns = [
      { id: 'TR-001', t0: at(-5), state: 'PENDIENTE_PAGO' },
      { id: 'TR-002', t0: at(-5), state: 'CITADO', cita: cita('m.consulta', 2000) },
      { id: 'TR-003', t0: at(-5), state: 'LLAMADO_TRIAJE', tTriCall: at(-1) },
    ];
    expect(est(turns)).toEqual({});
  });

  it('se muestra como un rango de 5 minutos', () => {
    expect(rangoEspera(null)).toBeNull();
    expect(rangoEspera(3)).toBe('menos de 5 min');
    expect(rangoEspera(12)).toBe('10 a 15 min');
    expect(rangoEspera(15)).toBe('15 a 20 min');
  });
});
