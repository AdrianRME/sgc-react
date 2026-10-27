import { applyChanges, EMPTY_DB } from './merge.js';
import { DEMO_PASSWORD, ACTIVE_STATES, DAY } from '../lib/constants.js';
import { isCurrent } from '../lib/clinical.js';
import { toFacts } from '../lib/analytics.js';
import { lastComprobante, lastRecipe, uid } from '../lib/ids.js';
import { citaActivaDe, pacienteVerificado, reservarCita } from '../store/actions.js';

// v4: pago, cita y horarios médicos (los datos guardados con versiones anteriores se vuelven a sembrar)
const KEY = 'sgc-db-v4';
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
        meta: { recMax: lastRecipe(db.turns), compMax: lastComprobante(db.turns) },
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
    /* Cita por web o por teléfono (en Supabase: sgc_paciente_cita, sgc_cupos y sgc_reservar_cita) */
    async pacienteCita(dni, nac) {
      const db = await ensure();
      const p = pacienteVerificado(db, dni, nac);
      if (!p) throw new Error('No encontramos un paciente con ese DNI y esa fecha de nacimiento. Si es su primera atención, acérquese a Admisión para abrir su historia clínica.');
      return { nom: p.nom.split(' ')[0], activa: citaActivaDe(db, p.dni) };
    },
    async cupos(esp) {
      const db = await ensure();
      return {
        users: db.users.filter((u) => u.role === 'med' && u.on && u.esp === esp),
        horarios: db.horarios.filter((h) => h.on),
        ocupadas: db.turns.filter((t) => t.cita && !t.cita.sobre && t.state !== 'CANCELADO').map((t) => ({ med: t.cita.med, at: t.cita.at })),
      };
    },
    async reservarCita(dni, nac, cita) {
      const db = await ensure();
      const me = await this.getSession();
      // Por teléfono la registra Admisión con su sesión; el control, el médico al cerrar la atención; por la web, el usuario del sistema
      const staff = me && db.users.find((u) => u.u === me.u && ['adm', 'med'].includes(u.role));
      const user = staff || db.users.find((u) => u.u === 'a.citasweb') || { u: 'a.citasweb' };
      const canal = !staff ? 'web' : staff.role === 'med' ? 'control médico' : 'teléfono';
      const r = reservarCita(db, { user, now: Date.now(), ip: '' }, { dni, nac, cita, canal });
      const next = applyChanges(db, r.changes);
      write(next);
      return citaActivaDe(next, r.result.dni);
    },
    subscribe(onChange) {
      const h = (e) => e.key === KEY && onChange();
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
}
