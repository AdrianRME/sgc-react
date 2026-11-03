/**
 * Reloj de la simulación en vivo. Mientras corre, las pantallas reales deben ver la hora del caso (por ejemplo,
 * las 8:00 de un día hábil o la hora de la cita), no la del equipo: se adelanta o atrasa Date.now() y se avisa
 * a useNow() para que el reloj de cada pantalla salte de inmediato. Al detener la simulación vuelve la hora real.
 */
const real = Date.now.bind(Date);

/** Hora real del equipo, aunque la simulación haya movido el reloj. */
export const ahoraReal = () => real();

export const EVENTO_RELOJ = 'sgc:reloj';

/** Fija la hora que ven las pantallas (`null` vuelve a la hora real). */
export function fijarReloj(t) {
  if (t == null) {
    Date.now = real;
  } else {
    const offset = t - real();
    Date.now = () => real() + offset;
  }
  window.dispatchEvent(new Event(EVENTO_RELOJ));
}
