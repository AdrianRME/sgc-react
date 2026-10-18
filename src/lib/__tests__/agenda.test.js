import { describe, it, expect } from 'vitest';
import { buildSeed } from '../seed.js';
import {
  cuposLibres, deTurnoHoy, diasDeAtencion, especialidad, especialidadSugerida, isoDow, listaDias, toMin, validarCita,
} from '../agenda.js';
import { ACTIVE_STATES, SIS_EXONERADO } from '../constants.js';
import { removeHorario, saveHorario } from '../../store/actions.js';
import { applyChanges } from '../../data/merge.js';

// Lunes 12 de octubre de 2026, 09:10
const NOW = new Date(2026, 9, 12, 9, 10).getTime();
const seed = buildSeed(NOW);
const jef = { user: seed.users.find((u) => u.u === 'j.jefatura'), now: NOW, ip: '' };
const minOf = (t) => new Date(t).getHours() * 60 + new Date(t).getMinutes();

describe('horario y cupos', () => {
  it('cada especialidad atiende los días de su horario', () => {
    expect(listaDias(diasDeAtencion(seed, 'CAR'))).toBe('martes y jueves');
    expect(listaDias(diasDeAtencion(seed, 'PED'))).toBe('lunes, miércoles y viernes');
  });

  it('los cupos caen dentro del horario, cada duración de la especialidad, y no se repiten', () => {
    const cupos = cuposLibres(seed, 'CAR', NOW, { dias: 14 });
    expect(cupos.length).toBeGreaterThan(0);
    cupos.forEach((c) => {
      expect([2, 4]).toContain(isoDow(c.at));
      expect(c.at).toBeGreaterThan(NOW);
      expect((minOf(c.at) - toMin('08:00')) % especialidad('CAR').dur).toBe(0);
      expect(minOf(c.at) + 30).toBeLessThanOrEqual(toMin('13:00'));
    });
    expect(new Set(cupos.map((c) => `${c.med}${c.at}`)).size).toBe(cupos.length);
  });

  it('un cupo con cita vigente deja de ofrecerse, salvo al reprogramar esa misma cita', () => {
    const libre = cuposLibres(seed, 'MG', NOW, { limit: 1 })[0];
    const t = { id: 'TR-999', t0: NOW, dni: '1', state: 'CITADO', cita: { esp: 'MG', med: libre.med, area: libre.area, at: libre.at, sobre: false } };
    const db = { ...seed, turns: [...seed.turns, t] };
    expect(cuposLibres(db, 'MG', NOW, { med: libre.med }).some((c) => c.at === libre.at)).toBe(false);
    expect(cuposLibres(db, 'MG', NOW, { med: libre.med, except: `TR-999@${NOW}` }).some((c) => c.at === libre.at)).toBe(true);
    expect(() => validarCita(db, { esp: 'MG', med: libre.med, at: libre.at }, { now: NOW, prio: 'NORMAL' })).toThrow(/tomado/);
  });

  it('valida médico, especialidad, día, hora y sobrecupo', () => {
    const car = cuposLibres(seed, 'CAR', NOW, { limit: 1 })[0];
    const ok = { esp: 'CAR', med: 'm.cardio', at: car.at };
    expect(validarCita(seed, ok, { now: NOW, prio: 'NORMAL' }).area).toBe('Consultorio 2');
    expect(() => validarCita(seed, { ...ok, med: 'm.consulta' }, { now: NOW, prio: 'NORMAL' })).toThrow(/no atiende Cardiología/);
    expect(() => validarCita(seed, { ...ok, at: car.at + 10 * 60_000 }, { now: NOW, prio: 'NORMAL' })).toThrow(/no es un cupo/);
    expect(() => validarCita(seed, { ...ok, at: NOW + 3600_000 }, { now: NOW, prio: 'NORMAL' })).toThrow(/no atiende los lunes/);
    expect(() => validarCita(seed, { ...ok, at: NOW + 40 * 86_400_000 }, { now: NOW, prio: 'NORMAL' })).toThrow(/próximos 30 días/);
    expect(() => validarCita(seed, ok, { now: NOW, prio: 'CRITICA' })).toThrow(/debe atenderse hoy/);
    const sobre = { esp: 'MG', med: 'm.consulta', at: NOW, sobre: true };
    expect(() => validarCita(seed, sobre, { now: NOW, prio: 'NORMAL' })).toThrow(/solo para pacientes con prioridad crítica/);
    expect(validarCita(seed, sobre, { now: NOW, prio: 'CRITICA' }).area).toBe('Consultorio 1');
  });

  it('el médico de turno para un crítico es el que está atendiendo ahora', () => {
    expect(deTurnoHoy(seed, NOW, 'MG')[0]).toMatchObject({ med: 'm.consulta', ahora: true });
    expect(deTurnoHoy(seed, new Date(2026, 9, 11, 10, 0).getTime(), 'MG')).toEqual([]); // domingo: nadie atiende
  });

  it('la especialidad sugerida depende de la edad y del motivo', () => {
    const p = (nac) => ({ nac });
    expect(especialidadSugerida(p('2020-01-01'), { motivo: 'Fiebre' }, NOW)).toBe('PED');
    expect(especialidadSugerida(p('1960-01-01'), { motivo: 'Palpitaciones' }, NOW)).toBe('CAR');
    expect(especialidadSugerida(p('1960-01-01'), { motivo: 'Dolor de garganta' }, NOW)).toBe('MG');
  });
});

describe('horarios médicos (Jefatura)', () => {
  it('no se cruzan los bloques de un médico ni dos médicos en un consultorio', () => {
    expect(() => saveHorario(seed, jef, { med: 'm.cardio', dow: 1, ini: '09:00', fin: '12:00', area: 'Consultorio 2' })).toThrow(/Consultorio 2 está asignado/);
    expect(() => saveHorario(seed, jef, { med: 'm.consulta', dow: 1, ini: '12:00', fin: '14:00', area: 'Consultorio 2' })).toThrow(/ya atiende ese día/);
    expect(() => saveHorario(seed, jef, { med: 'm.cardio', dow: 6, ini: '08:00', fin: '08:20', area: 'Consultorio 2' })).toThrow(/al menos una cita/);
    const r = saveHorario(seed, jef, { med: 'm.cardio', dow: 6, ini: '08:00', fin: '12:00', area: 'Consultorio 2' });
    const db = applyChanges(seed, r.changes);
    expect(listaDias(diasDeAtencion(db, 'CAR'))).toBe('martes, jueves y sábado');
  });

  it('un bloque con citas por atender no se puede quitar', () => {
    const t = seed.turns.find((x) => x.state === 'CITADO');
    const h = seed.horarios.find((x) => x.med === t.cita.med && x.dow === isoDow(t.cita.at));
    expect(() => removeHorario(seed, jef, h.id)).toThrow(/por atender/);
    const libre = seed.horarios.find((x) => !seed.turns.some((y) => y.cita?.med === x.med && ACTIVE_STATES.includes(y.state) && isoDow(y.cita.at) === x.dow));
    expect(applyChanges(seed, removeHorario(seed, jef, libre.id).changes).horarios.find((x) => x.id === libre.id).on).toBe(false);
  });
});

describe('demostración con pago y citas', () => {
  it('quien pasó por triaje pagó antes (o tiene SIS), y quien fue atendido tuvo cita', () => {
    const sis = new Map(seed.patients.map((p) => [p.dni, p.sis]));
    seed.turns.filter((t) => t.tTriCall).forEach((t) => {
      expect(t.pago, t.id).toBeTruthy();
      expect(t.pago.metodo === 'SIS', t.id).toBe(SIS_EXONERADO.includes(sis.get(t.dni)));
    });
    seed.turns.filter((t) => t.state === 'ATENDIDO').forEach((t) => expect(t.cita && t.cita.med === t.consult.medico.u, t.id).toBe(true));
    const comps = seed.turns.filter((t) => t.pago?.comp).map((t) => t.pago.comp);
    expect(new Set(comps).size).toBe(comps.length);
  });

  it('las citas generadas respetan el horario y ningún cupo se da dos veces', () => {
    const hist = seed.turns.filter((t) => t.cita && !t.cita.sobre && t.t0 < new Date(2026, 9, 12).getTime());
    hist.forEach((t) => {
      const e = especialidad(t.cita.esp);
      const h = seed.horarios.find((x) => x.med === t.cita.med && x.dow === isoDow(t.cita.at)
        && minOf(t.cita.at) >= toMin(x.ini) && minOf(t.cita.at) + e.dur <= toMin(x.fin));
      expect(h, `${t.id} ${new Date(t.cita.at)}`).toBeTruthy();
    });
    const vigentes = seed.turns.filter((t) => t.cita && !t.cita.sobre && t.state !== 'CANCELADO').map((t) => `${t.cita.med}@${t.cita.at}`);
    expect(new Set(vigentes).size).toBe(vigentes.length);
  });

  it('hay citas para otro día cuando la especialidad no atiende ese día', () => {
    const otro = seed.turns.filter((t) => t.cita && new Date(t.cita.at).toDateString() !== new Date(t.t0).toDateString());
    expect(otro.length).toBeGreaterThan(10);
    expect(otro.some((t) => t.cita.esp === 'CAR')).toBe(true);
  });

  it('un código de turno no se repite entre los turnos abiertos', () => {
    const open = seed.turns.filter((t) => ACTIVE_STATES.includes(t.state) || t.t0 >= new Date(2026, 9, 12).getTime()).map((t) => t.id);
    expect(new Set(open).size).toBe(open.length);
  });
});
