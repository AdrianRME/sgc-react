import { ACTIVE_STATES, MIN } from './constants.js';

/**
 * Portal del paciente («Mi atención»): el propio paciente consulta su cita, sus atenciones y sus recetas.
 *
 * Acceso en dos pasos, porque aquí se muestran datos clínicos y el DNI con la fecha de nacimiento los puede
 * conocer otra persona:
 *   1. DNI + fecha de nacimiento (lo que sabe) → se envía un código de un solo uso al celular registrado.
 *   2. Ese código (lo que tiene) → se abre el portal.
 * El portal es de solo lectura: para cambiar o anular una cita sigue haciendo falta llamar o ir a Admisión.
 * Aquí están las reglas puras; el envío y la verificación del código los hace el repositorio (o la base).
 */

/** Minutos de validez de un código y cuántas veces se puede fallar antes de pedir otro. */
export const CODIGO_MIN = 5;
export const CODIGO_INTENTOS = 3;
/** Minutos sin actividad tras los que el portal se cierra solo (puede quedar abierto en un equipo compartido). */
export const PORTAL_INACTIVO_MIN = 5;

/** El celular registrado, mostrando solo los tres últimos dígitos: «••• ••• 101». Vacío si no hay celular. */
export function mascaraTel(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length >= 6 ? `••• ••• ${d.slice(-3)}` : '';
}

/** Código de un solo uso: seis dígitos. `rnd` se puede fijar en las pruebas. */
export const nuevoCodigo = (rnd = Math.random) => String(Math.floor(rnd() * 1e6)).padStart(6, '0');

/**
 * Comprueba un código contra el que se envió. `envio` = { codigo, vence, intentos }.
 * Devuelve { ok } o { ok: false, error, agotado } (con `agotado` hay que pedir un código nuevo).
 */
export function comprobarCodigo(envio, codigo, now) {
  if (!envio) return { ok: false, agotado: true, error: 'Pida primero su código.' };
  if (now > envio.vence) return { ok: false, agotado: true, error: `El código venció (dura ${CODIGO_MIN} minutos). Pida uno nuevo.` };
  if (String(codigo).trim() === envio.codigo) return { ok: true };
  const quedan = CODIGO_INTENTOS - (envio.intentos + 1);
  return quedan > 0
    ? { ok: false, agotado: false, error: `Código incorrecto. Le ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.` }
    : { ok: false, agotado: true, error: 'Código incorrecto. Por seguridad, pida un código nuevo.' };
}
export const venceEn = (now) => now + CODIGO_MIN * MIN;

/**
 * Lo que ve el paciente, armado a partir de su ficha y de sus turnos.
 * Nunca incluye las notas clínicas del médico (anamnesis y examen): solo diagnóstico, receta y destino,
 * que son los datos que el paciente ya recibe impresos al salir de la consulta.
 */
export function resumenPaciente({ patient, turns, users = [] }) {
  const medico = (u, alt) => users.find((x) => x.u === u)?.n ?? alt ?? u;
  const propios = turns.filter((t) => t.dni === patient.dni);
  const act = propios.filter((t) => ACTIVE_STATES.includes(t.state)).sort((a, b) => b.t0 - a.t0)[0];
  const atenciones = propios
    .filter((t) => t.state === 'ATENDIDO' && t.consult)
    .sort((a, b) => b.consult.t - a.consult.t)
    .map((t) => {
      const c = t.consult;
      return {
        id: t.id,
        t: c.t,
        esp: t.cita?.esp ?? null,
        medico: c.medico?.n ?? medico(t.cita?.med),
        col: c.medico?.col ?? '',
        area: c.area ?? t.cita?.area ?? '',
        dx: c.dx ?? [],
        meds: c.meds ?? [],
        rec: c.rec ?? null,
        dest: c.dest ?? '',
        tri: t.tri ? { pa: t.tri.pa, fc: t.tri.fc, t: t.tri.t, spo2: t.tri.spo2, peso: t.tri.peso, talla: t.tri.talla } : null,
      };
    });
  return {
    pac: { dni: patient.dni, nom: patient.nom, ape: patient.ape, nac: patient.nac, hc: patient.hc, sis: patient.sis, alg: patient.alg ?? '' },
    activa: act ? {
      id: act.id,
      state: act.state,
      dest: act.dest ?? null,
      cita: act.cita ? { esp: act.cita.esp, at: act.cita.at, area: act.cita.area, medico: medico(act.cita.med, act.cita.medico) } : null,
    } : null,
    atenciones,
    recetas: atenciones.filter((a) => a.rec),
  };
}
