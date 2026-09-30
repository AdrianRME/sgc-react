/** Clave primaria de cada colección. */
export const KEYS = { patients: 'dni', turns: 'id', users: 'u', audit: 'id', thresholds: 'id' };

export const EMPTY_DB = { patients: [], turns: [], users: [], audit: [], thresholds: [] };

/** Aplica cambios (upserts por clave) sobre una copia de la base. */
export function applyChanges(db, changes) {
  const next = { ...db };
  for (const [table, rows] of Object.entries(changes || {})) {
    if (!rows?.length) continue;
    const key = KEYS[table];
    const map = new Map(next[table].map((r) => [r[key], r]));
    rows.forEach((r) => map.set(r[key], r));
    next[table] = [...map.values()];
  }
  next.audit = [...next.audit].sort((a, b) => b.t - a.t);
  return next;
}
