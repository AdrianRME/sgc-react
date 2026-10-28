import { describe, expect, it } from 'vitest';
import { ESCENARIOS, crearSandbox, ejecutar, relojInicial } from '../simulacion.js';

// Un martes cualquiera, para que los resultados no dependan del día en que se corren las pruebas
const reloj = relojInicial(new Date('2026-10-27T10:00:00').getTime());
const base = crearSandbox(reloj);

describe('simulador del ciclo del paciente', () => {
  it('empieza un día de semana a las 8:00 sin turnos abiertos', () => {
    expect(new Date(reloj).getHours()).toBe(8);
    expect(relojInicial(new Date('2026-10-31T10:00:00').getTime())).toBe(new Date('2026-11-02T08:00:00').getTime());
    expect(base.turns.some((t) => t.t0 >= reloj - 8 * 3600_000)).toBe(false);
  });

  it.each(ESCENARIOS.map((e) => [e.titulo, e]))('%s corre de principio a fin con las reglas del sistema', (_, esc) => {
    const fotos = ejecutar(esc, base, reloj);
    expect(fotos).toHaveLength(esc.pasos.length);
    const fin = fotos.at(-1).turno;
    expect(['ATENDIDO', 'CANCELADO']).toContain(fin.state);
    // Los pasos que el sistema debe impedir o que fallan no cambian los datos
    fotos.forEach((f, i) => {
      if (f.paso.rechazo || f.paso.falla) {
        expect(f.error).toBeTruthy();
        expect(f.db).toBe(fotos[i - 1].db);
      }
    });
    // No toca la copia base
    expect(base.turns.some((t) => t.dni === fin.dni && t.t0 >= reloj)).toBe(false);
  });

  // Los horarios cambian según el día (Cardiología solo martes y jueves, Pediatría lunes, miércoles y viernes)
  it.each(['2026-10-26', '2026-10-28', '2026-10-29', '2026-10-30'])('todos los casos funcionan el %s', (dia) => {
    const r = relojInicial(new Date(`${dia}T10:00:00`).getTime());
    const b = crearSandbox(r);
    ESCENARIOS.forEach((e) => expect(['ATENDIDO', 'CANCELADO']).toContain(ejecutar(e, b, r).at(-1).turno.state));
  });

  it('cada caso llega al resultado esperado', () => {
    const fin = (k) => ejecutar(ESCENARIOS.find((e) => e.k === k), base, reloj).at(-1).turno;
    expect(fin('nuevo-sis').pago.metodo).toBe('SIS');
    expect(fin('nuevo-sin-sis').pago.comp).toMatch(/^B001-\d{6}$/);
    expect(fin('critico')).toMatchObject({ prio: 'CRITICA', cita: { sobre: true }, consult: { dest: 'Derivación a hospital' } });
    expect(fin('historial').consult.meds.map((m) => m.n)).not.toContain('Amoxicilina 500 mg');
    expect(fin('no-se-presenta').cancel.motivo).toBe('No se presentó al llamado');
    expect(fin('sin-conexion').pago.metodo).toBe('TARJETA');
  });
});
