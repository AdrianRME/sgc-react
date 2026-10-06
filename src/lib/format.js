import { DAY, MIN } from './constants.js';

const LOCALE = 'es-PE';
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric' });
const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const numFmt = new Intl.NumberFormat(LOCALE);

export const DOW_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** Día de la semana: «Lunes» o, corto, «Lun». */
export const dowName = (d, short = false) => cap(short ? DOW_NAMES[d].slice(0, 3) : DOW_NAMES[d]);

export const fmtT = (t) => timeFmt.format(t);
export const fmtD = (t) => dateFmt.format(t);
export const fmtDT = (t) => `${fmtD(t)} ${fmtT(t)}`;
/** «lun 22»: etiqueta corta de un día en los ejes. */
export const fmtDay = (t) => dayFmt.format(t).replace('.', '');
export const fmtLongDay = (t) => longDayFmt.format(t);
export const fmtNum = (n) => (n == null ? '—' : numFmt.format(n));
export const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);

/** Minutos legibles: «45 min», «1 h 05 min». */
export function fmtMin(m) {
  if (m == null || Number.isNaN(m)) return '—';
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')} min`;
}

/** «hace 3 min», «hace 2 h», o la fecha si pasó más de un día. */
export function fmtAgo(t, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / MIN));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 24 * 60) return `hace ${Math.round(m / 60)} h`;
  return fmtD(t);
}

export const ageAt = (nac, t = Date.now()) => Math.floor((t - new Date(`${nac}T00:00:00`)) / (365.25 * DAY));
export const age = (nac) => ageAt(nac);
export const maskDni = (dni) => `${String(dni).slice(0, 3)}•••••`;
export const fullName = (p) => (p ? `${p.nom} ${p.ape}` : '—');
export const initials = (name = '') =>
  name.replace(/\(.*?\)|Dra?\.\s*/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Inicio del día local de `t`: los indicadores de «hoy» se calculan desde medianoche. */
export const startOfDay = (t = Date.now()) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const startOfToday = () => startOfDay();

/** Fecha local en formato ISO (AAAA-MM-DD), sin pasar por UTC. */
export const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
