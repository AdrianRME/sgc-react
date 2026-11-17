import { describe, expect, it } from 'vitest';
import { CODIGO_INTENTOS, comprobarCodigo, mascaraTel, nuevoCodigo, resumenPaciente, venceEn } from '../portal.js';

const patient = { dni: '70000001', nom: 'Lucía', ape: 'Paredes Quispe', nac: '1988-04-12', hc: 'HC-000101', sis: 'ACTIVO', alg: 'Penicilina', tel: '999 000 101' };
const users = [{ u: 'm.consulta', n: 'Dra. Elena Ríos' }];
const atendido = (id, t, extra = {}) => ({
  id, dni: '70000001', state: 'ATENDIDO', t0: t - 1000,
  cita: { esp: 'MG', med: 'm.consulta', area: 'Consultorio 1', at: t },
  tri: { pa: '120/80', fc: 72, t: 36.8, spo2: 98, peso: 60, talla: 1.6, motivo: 'Dolor de garganta' },
  consult: {
    t, notas: 'Paciente refiere dolor intenso; antecedente familiar reservado', rec: `REC-${id}`, dest: 'Alta', area: 'Consultorio 1',
    dx: [['J00', 'Rinofaringitis aguda', 'D']], meds: [{ n: 'Paracetamol 500 mg', dosis: '1 tableta', frec: 'cada 8 h', dias: 3 }],
    medico: { u: 'm.consulta', n: 'Dra. Elena Ríos', col: 'CMP-00000' },
  },
  ...extra,
});

describe('portal del paciente', () => {
  it('muestra solo los tres últimos dígitos del celular', () => {
    expect(mascaraTel('999 000 101')).toBe('••• ••• 101');
    expect(mascaraTel('')).toBe('');
    expect(mascaraTel(null)).toBe('');
  });

  it('genera códigos de seis dígitos, también cuando empiezan en cero', () => {
    expect(nuevoCodigo(() => 0.000012)).toBe('000012');
    expect(nuevoCodigo(() => 0.999999)).toHaveLength(6);
  });

  it('acepta el código correcto dentro del plazo y rechaza el vencido', () => {
    const now = 1_000_000;
    const envio = { codigo: '123456', vence: venceEn(now), intentos: 0 };
    expect(comprobarCodigo(envio, ' 123456 ', now).ok).toBe(true);
    const tarde = comprobarCodigo(envio, '123456', envio.vence + 1);
    expect(tarde.ok).toBe(false);
    expect(tarde.agotado).toBe(true);
  });

  it('agota el código al tercer intento fallido', () => {
    const now = 1_000_000;
    const envio = { codigo: '123456', vence: venceEn(now), intentos: 0 };
    expect(comprobarCodigo(envio, '000000', now).agotado).toBe(false);
    expect(comprobarCodigo({ ...envio, intentos: CODIGO_INTENTOS - 1 }, '000000', now).agotado).toBe(true);
    expect(comprobarCodigo(null, '123456', now).agotado).toBe(true);
  });

  it('nunca entrega las notas clínicas del médico', () => {
    const r = resumenPaciente({ patient, turns: [atendido('TR-001', 2000)], users });
    expect(JSON.stringify(r)).not.toContain('antecedente familiar reservado');
    expect(r.atenciones[0]).not.toHaveProperty('notas');
    // El motivo que el paciente contó en triaje tampoco viaja: solo sus signos
    expect(r.atenciones[0].tri).not.toHaveProperty('motivo');
  });

  it('ordena las atenciones de la más reciente a la más antigua y lista sus recetas', () => {
    const r = resumenPaciente({ patient, turns: [atendido('TR-001', 2000), atendido('TR-009', 9000)], users });
    expect(r.atenciones.map((a) => a.id)).toEqual(['TR-009', 'TR-001']);
    expect(r.recetas.map((a) => a.rec)).toEqual(['REC-TR-009', 'REC-TR-001']);
    expect(r.atenciones[0]).toMatchObject({ medico: 'Dra. Elena Ríos', esp: 'MG', dest: 'Alta' });
  });

  it('solo incluye los turnos del propio paciente', () => {
    const ajeno = atendido('TR-777', 5000, { dni: '70000002' });
    const r = resumenPaciente({ patient, turns: [atendido('TR-001', 2000), ajeno], users });
    expect(r.atenciones.map((a) => a.id)).toEqual(['TR-001']);
  });

  it('trae la cita pendiente con el nombre del médico', () => {
    const cita = { id: 'TR-050', dni: '70000001', state: 'CITADO', t0: 9500, cita: { esp: 'CAR', med: 'm.consulta', area: 'Consultorio 2', at: 99_000 } };
    const r = resumenPaciente({ patient, turns: [atendido('TR-001', 2000), cita], users });
    expect(r.activa).toMatchObject({ id: 'TR-050', state: 'CITADO', cita: { esp: 'CAR', medico: 'Dra. Elena Ríos', area: 'Consultorio 2' } });
    expect(resumenPaciente({ patient, turns: [atendido('TR-001', 2000)], users }).activa).toBeNull();
  });
});
