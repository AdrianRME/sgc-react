import { DAY } from './constants.js';

export const fmtT = (t) => new Date(t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
export const fmtD = (t) => new Date(t).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtDT = (t) => `${fmtD(t)} ${fmtT(t)}`;
export const age = (nac) => Math.floor((Date.now() - new Date(nac)) / (365.25 * DAY));
export const maskDni = (dni) => `${String(dni).slice(0, 3)}•••••`;
export const fullName = (p) => (p ? `${p.nom} ${p.ape}` : '—');

/** Inicio del día local: los indicadores de "hoy" se calculan desde medianoche. */
export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
