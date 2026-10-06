import { turnKey } from '../lib/clinical.js';

/** Clave única de cada colección (el código de turno se reinicia cada día: ver turnKey). */
export const KEYS = {
  patients: (r) => r.dni,
  turns: turnKey,
  users: (r) => r.u,
  audit: (r) => r.id,
  thresholds: (r) => r.id,
};

export const EMPTY_DB = { patients: [], turns: [], users: [], audit: [], thresholds: [], meta: {} };

/** Aplica cambios (altas y actualizaciones por clave) sobre una copia de la base. */
export function applyChanges(db, changes) {
  const next = { ...db };
  for (const [table, rows] of Object.entries(changes || {})) {
    if (!rows?.length) continue;
    const key = KEYS[table];
    const map = new Map(next[table].map((r) => [key(r), r]));
    rows.forEach((r) => {
      const { clave_temporal: _secret, ...clean } = r; // las contraseñas nunca se guardan en el estado local
      map.set(key(r), clean);
    });
    next[table] = [...map.values()];
  }
  next.audit = [...next.audit].sort((a, b) => b.t - a.t);
  return next;
}
