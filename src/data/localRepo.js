import { applyChanges, EMPTY_DB } from './merge.js';
import { DEMO_PASSWORD, ACTIVE_STATES, DAY } from '../lib/constants.js';
import { isCurrent } from '../lib/clinical.js';
import { toFacts } from '../lib/analytics.js';
import { lastRecipe, uid } from '../lib/ids.js';

const KEY = 'sgc-db-v3';
const SESSION = 'sgc-local-session';
const dayStart = (iso) => new Date(`${iso}T00:00:00`).getTime();

/**
 * Repositorio en localStorage, solo para desarrollo sin Supabase. Ofrece la misma interfaz que el de
 * Supabase: la carga trae los turnos de trabajo y la historia y los indicadores se consultan aparte.
 * El inicio de sesión es de demostración: una contraseña común comprobada en el navegador.
 */
export function createLocalRepo() {
  const read = () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...EMPTY_DB, ...JSON.parse(raw) } : null;
    } catch {
      return null;
    }
  };
  const write = (db) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      /* almacenamiento lleno o bloqueado: la app sigue en memoria */
    }
  };
  // La semilla (varias semanas de datos) se descarga solo cuando hace falta.
  const seed = async () => (await import('../lib/seed.js')).buildSeed();
  const ensure = async () => {
    let db = read();
    if (!db || !db.users.length) {
      db = await seed();
      write(db);
    }
    return db;
  };
  const listeners = new Set();
  const setSession = (auth) => {
    try {
      if (auth) sessionStorage.setItem(SESSION, JSON.stringify(auth));
      else sessionStorage.removeItem(SESSION);
    } catch {
      /* sin sessionStorage */
    }
    listeners.forEach((cb) => cb(auth));
  };

  return {
    kind: 'local',
    label: 'Modo local (solo desarrollo)',
    async getSession() {
      try {
        return JSON.parse(sessionStorage.getItem(SESSION)) || null;
      } catch {
        return null;
      }
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(u, password) {
      const user = (await ensure()).users.find((x) => x.u === u.trim().toLowerCase());
      if (!user || password !== DEMO_PASSWORD) throw new Error('Usuario o contraseña incorrectos.');
      if (!user.on) throw new Error('El usuario está desactivado. Contacte a Jefatura.');
      const auth = { u: user.u, mustChange: false };
      setSession(auth);
      return auth;
    },
    async signOut() {
      setSession(null);
    },
    async changePassword() {
      // En modo local no hay contraseñas por usuario: solo se registra el evento, como en el servidor
      await this.audit('CAMBIO_CLAVE', (u) => `${u} cambió su contraseña`);
    },
    /** Auditoría que en Supabase escribe el servidor (lectura de historia, cambio de clave). */
    async audit(a, detail) {
      const me = await this.getSession();
      if (me) write(applyChanges(read() || EMPTY_DB, { audit: [{ id: uid(), t: Date.now(), u: me.u, a, d: detail(me.u), ip: '' }] }));
    },
    async load() {
      const db = await ensure();
      const me = await this.getSession();
      const now = Date.now();
      return {
        ...db,
        turns: db.turns.filter((t) => isCurrent(t, now)),
        meta: { recMax: lastRecipe(db.turns) },
        me: me && { username: me.u },
      };
    },
    async save(changes) {
      write(applyChanges(read() || EMPTY_DB, changes));
    },
    async reset(data) {
      write(data || (await seed()));
      return this.load();
    },
    async historia(dni) {
      const db = read() || EMPTY_DB;
      const hc = db.patients.find((p) => p.dni === dni)?.hc ?? 'DNI desconocido';
      await this.audit('HC_CONSULTADA', () => `${hc} consultada (historia)`);
      return db.turns.filter((t) => t.dni === dni).sort((a, b) => b.t0 - a.t0);
    },
    async indicadores(desde, hasta) {
      const db = read() || EMPTY_DB;
      const from = dayStart(desde);
      const to = dayStart(hasta) + DAY;
      return toFacts(db.turns.filter((t) => t.t0 >= from && t.t0 < to), db.patients);
    },
    async sala() {
      return (read() || EMPTY_DB).turns.filter((t) => ACTIVE_STATES.includes(t.state));
    },
    subscribe(onChange) {
      const h = (e) => e.key === KEY && onChange();
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
}
