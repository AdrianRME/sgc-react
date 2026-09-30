import { createClient } from '@supabase/supabase-js';
import { buildSeed } from '../lib/seed.js';

/*
 * Mapeo entre los objetos de la app y las tablas de supabase/schema.sql.
 * En "turns" las columnas de consulta frecuente van aparte y el resto en "data" (jsonb).
 */
const map = {
  users: {
    table: 'staff',
    key: 'u',
    to: (x) => ({ u: x.u, n: x.n, role: x.role, col: x.col || null, activo: x.on }),
    from: (r) => ({ u: r.u, n: r.n, role: r.role, col: r.col || '', on: r.activo }),
  },
  patients: {
    table: 'patients',
    key: 'dni',
    to: (x) => ({ ...x, nac: x.nac || null }),
    from: (r) => ({ ...r, ant: r.ant || '', alg: r.alg || '', tel: r.tel || '' }),
  },
  turns: {
    table: 'turns',
    key: 'id',
    to: ({ id, dni, state, prio, t0, ...data }) => ({ id, dni, state, prio, t0, data }),
    from: ({ id, dni, state, prio, t0, data }) => ({ ...data, id, dni, state, prio, t0: Number(t0) }),
  },
  audit: {
    table: 'audit_log',
    key: 'id',
    to: (x) => x,
    from: (r) => ({ ...r, t: Number(r.t) }),
  },
  thresholds: {
    table: 'thresholds',
    key: 'id',
    to: (x) => ({ id: x.id, vals: x.vals, approved_by: x.by, since: x.since }),
    from: (r) => ({ id: r.id, vals: r.vals, by: r.approved_by, since: Number(r.since) }),
  },
};

// Orden de inserción (respeta claves foráneas) y de borrado (inverso).
const ORDER = ['users', 'patients', 'thresholds', 'turns', 'audit'];

export function createSupabaseRepo(url, anonKey) {
  const sb = createClient(url, anonKey);

  const check = ({ data, error }) => {
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data;
  };

  async function fetchAll() {
    const db = {};
    await Promise.all(
      ORDER.map(async (k) => {
        let q = sb.from(map[k].table).select('*');
        if (k === 'audit') q = q.order('t', { ascending: false }).limit(500);
        db[k] = check(await q).map(map[k].from);
      }),
    );
    return db;
  }

  async function insertAll(db) {
    for (const k of ORDER) {
      if (db[k].length) check(await sb.from(map[k].table).upsert(db[k].map(map[k].to)));
    }
  }

  return {
    kind: 'supabase',
    label: 'Supabase · tiempo real',
    async load() {
      const db = await fetchAll();
      if (!db.users.length) {
        const seed = buildSeed();
        await insertAll(seed);
        return seed;
      }
      return db;
    },
    async save(changes) {
      for (const k of ORDER) {
        const rows = changes[k];
        if (rows?.length) check(await sb.from(map[k].table).upsert(rows.map(map[k].to)));
      }
    },
    async reset() {
      for (const k of [...ORDER].reverse()) {
        check(await sb.from(map[k].table).delete().not(map[k].key, 'is', null));
      }
      const seed = buildSeed();
      await insertAll(seed);
      return seed;
    },
    subscribe(onChange) {
      let timer;
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, 150);
      };
      const ch = sb.channel('sgc-cambios');
      ORDER.forEach((k) => ch.on('postgres_changes', { event: '*', schema: 'public', table: map[k].table }, debounced));
      ch.subscribe();
      return () => {
        clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
  };
}
