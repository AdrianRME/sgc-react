import { isCurrent } from './clinical.js';

/**
 * Correlativos derivados de los datos existentes (no de un contador en memoria),
 * así no se repiten al recargar ni entre varias PCs conectadas a la misma base.
 * Si dos estaciones generan el mismo código a la vez, la base lo rechaza (restricción única).
 */
const maxNum = (values, re) =>
  values.reduce((mx, v) => {
    const m = re.exec(v || '');
    return m ? Math.max(mx, +m[1]) : mx;
  }, 0);

/**
 * El código de turno se reinicia cada día (TR-001, TR-002…). Cuenta los turnos de hoy y los que
 * siguen activos de días anteriores, para que un código nunca se repita entre los turnos abiertos.
 */
export const nextTurnId = (turns, now = Date.now()) =>
  'TR-' + String(maxNum(turns.filter((t) => isCurrent(t, now)).map((t) => t.id), /^TR-(\d+)$/) + 1).padStart(3, '0');

/** Último número de receta del año entre los turnos dados. */
export const lastRecipe = (turns, year = new Date().getFullYear()) =>
  maxNum(turns.map((t) => t.consult?.rec), new RegExp(`^REC-${year}-(\\d+)$`));

/**
 * La receta es correlativa por año. Como cada estación solo carga los turnos de hoy,
 * `known` trae el último número del año que informa el servidor.
 */
export const nextRecipe = (turns, year = new Date().getFullYear(), known = 0) =>
  `REC-${year}-` + String(Math.max(known || 0, lastRecipe(turns, year)) + 1).padStart(6, '0');

export const nextHC = (patients) =>
  'HC-' + String(maxNum(patients.map((p) => p.hc), /^HC-(\d+)$/) + 1).padStart(6, '0');

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Contraseña temporal aleatoria (10 caracteres, letras y números, sin caracteres ambiguos). */
export function tempPassword() {
  const L = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', D = '23456789', A = L + D;
  const rnd = (n) => {
    const b = new Uint32Array(n);
    globalThis.crypto.getRandomValues(b);
    return [...b];
  };
  const r = rnd(10);
  const chars = r.map((x) => A[x % A.length]);
  chars[r[0] % 8 + 1] = D[r[1] % D.length]; // al menos un número
  chars[0] = L[r[2] % L.length];            // empieza con letra
  return chars.join('');
}
