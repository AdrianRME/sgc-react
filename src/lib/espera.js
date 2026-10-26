/**
 * Tiempo aproximado de espera de cada paciente en cola (RF-14), con la fórmula del capítulo IV del informe:
 *   espera = ⌈Q / c⌉ × t_medio
 * Q son los turnos por delante y c los puestos que atienden esa cola. Hay un solo módulo de triaje y cada
 * médico atiende solo a sus citados, así que c = 1 en ambas colas. Al paciente que se está atendiendo se le
 * cuenta solo lo que le falta (t_medio menos lo que ya lleva, mínimo 1 min). En consulta, además, nadie es
 * llamado antes de la hora de su cita.
 *
 * t_medio es el promedio móvil de las últimas ESPERA_N atenciones del día en esa etapa (en consulta, las del
 * mismo médico). Con menos de ESPERA_MIN_MUESTRAS se usa una referencia: TRIAJE_REF_MIN en triaje y la
 * duración del cupo de la especialidad en consulta.
 *
 * sgc_interno.esperas() hace el mismo cálculo en la base para la pantalla pública de sala.
 */
import { ESPECIALIDADES, MIN } from './constants.js';
import { startOfDay } from './format.js';
import { byArrival, byConsulta, turnKey } from './clinical.js';

export const ESPERA_N = 20;
export const ESPERA_MIN_MUESTRAS = 3;
export const TRIAJE_REF_MIN = 7;

const EN_TRIAJE = ['LLAMADO_TRIAJE', 'EN_TRIAJE'];
const EN_CONSULTA = ['LLAMADO_CONSULTA', 'EN_CONSULTA'];

/** Médico de un turno de consulta: el de su cita (o el que lo atendió). */
const medDe = (t) => t.cita?.med ?? t.consult?.medico?.u ?? t.med ?? null;

/** Promedio de las últimas ESPERA_N duraciones (ya ordenadas por hora de fin) o la referencia. */
function mediaMovil(durs, ref) {
  if (durs.length < ESPERA_MIN_MUESTRAS) return ref;
  const xs = durs.slice(-ESPERA_N);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Duraciones (min) de una etapa que terminó hoy, de la más antigua a la más reciente. */
const duraciones = (turns, from, to, desde, now, filtro) =>
  turns
    .filter((t) => t[from] != null && t[to] != null && t[to] >= desde && t[to] <= now && filtro(t))
    .sort((a, b) => a[to] - b[to])
    .map((t) => (t[to] - t[from]) / MIN);

/** Tiempos medios vigentes: triaje y consulta de cada médico (para mostrarlos junto a la estimación). */
export function tiemposMedios(turns, now) {
  const hoy = startOfDay(now);
  const tri = mediaMovil(duraciones(turns, 'tTriCall', 'tTriSave', hoy, now, () => true), TRIAJE_REF_MIN);
  const med = (u, esp) =>
    mediaMovil(
      duraciones(turns, 'tMedCall', 'tEnd', hoy, now, (t) => t.state === 'ATENDIDO' && (t.consult?.medico?.u ?? medDe(t)) === u),
      ESPECIALIDADES.find((e) => e.k === esp)?.dur ?? ESPECIALIDADES[0].dur,
    );
  return { tri, med };
}

/**
 * Minutos aproximados de espera de cada turno en cola, por turnKey. Solo se estiman los que esperan triaje
 * o consulta; el pago y la cita dependen de que el paciente se acerque a la ventanilla.
 */
export function estimarEsperas(turns, now) {
  const out = new Map();
  const { tri, med } = tiemposMedios(turns, now);
  const resto = (t, from, media) => Math.max(1, media - (now - t[from]) / MIN);

  const ocupadoTri = turns.filter((t) => EN_TRIAJE.includes(t.state)).reduce((a, t) => a + resto(t, 'tTriCall', tri), 0);
  turns
    .filter((t) => t.state === 'EN_ESPERA_TRIAJE')
    .sort(byArrival)
    .forEach((t, i) => out.set(turnKey(t), Math.round(ocupadoTri + i * tri)));

  const colas = new Map();
  for (const t of turns.filter((x) => x.state === 'EN_ESPERA_CONSULTA')) {
    const u = medDe(t);
    colas.set(u, [...(colas.get(u) || []), t]);
  }
  for (const [u, cola] of colas) {
    const tm = med(u, cola[0].cita?.esp);
    const ocupado = turns.filter((t) => EN_CONSULTA.includes(t.state) && medDe(t) === u).reduce((a, t) => a + resto(t, 'tMedCall', tm), 0);
    [...cola].sort(byConsulta).forEach((t, i) => {
      const hastaCita = t.cita ? (t.cita.at - now) / MIN : 0;
      out.set(turnKey(t), Math.round(Math.max(ocupado + i * tm, hastaCita)));
    });
  }
  return out;
}

/** Espera aproximada de un turno, o null si no está en una cola que se pueda estimar. */
export const esperaDe = (turns, turn, now) => estimarEsperas(turns, now).get(turnKey(turn)) ?? null;

/**
 * Rango de 5 minutos que contiene la estimación, para mostrarla como aproximación y no como promesa.
 * Con `aprox`, el rango lleva «≈» delante (donde no lo dice el texto que lo acompaña).
 */
export function rangoEspera(min, { aprox = false } = {}) {
  if (min == null) return null;
  if (min < 5) return 'menos de 5 min';
  const lo = Math.floor(min / 5) * 5;
  return `${aprox ? '≈ ' : ''}${lo} a ${lo + 5} min`;
}
