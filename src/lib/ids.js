/**
 * Correlativos derivados de los datos existentes (no de un contador en memoria),
 * así no se repiten al recargar ni entre varias PCs conectadas a la misma base.
 */
const maxNum = (values, re) =>
  values.reduce((mx, v) => {
    const m = re.exec(v || '');
    return m ? Math.max(mx, +m[1]) : mx;
  }, 0);

export const nextTurnId = (turns) =>
  'TR-' + String(maxNum(turns.map((t) => t.id), /^TR-(\d+)$/) + 1).padStart(3, '0');

export const nextRecipe = (turns, year = new Date().getFullYear()) =>
  `REC-${year}-` + String(maxNum(turns.map((t) => t.consult?.rec), /^REC-\d{4}-(\d+)$/) + 1).padStart(6, '0');

export const nextHC = (patients) =>
  'HC-' + String(maxNum(patients.map((p) => p.hc), /^HC-(\d+)$/) + 1).padStart(6, '0');

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
