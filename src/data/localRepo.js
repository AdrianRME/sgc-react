import { applyChanges, EMPTY_DB } from './merge.js';
import { buildSeed } from '../lib/seed.js';

const KEY = 'sgc-db-v2';

/**
 * Repositorio en localStorage. Los cambios se sincronizan entre pestañas del
 * mismo navegador (evento "storage"), así la pantalla de sala funciona en otra pestaña.
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

  return {
    kind: 'local',
    label: 'Datos locales (este navegador)',
    async load() {
      let db = read();
      if (!db || !db.users.length) {
        db = buildSeed();
        write(db);
      }
      return db;
    },
    async save(changes) {
      write(applyChanges(read() || EMPTY_DB, changes));
    },
    async reset() {
      const db = buildSeed();
      write(db);
      return db;
    },
    subscribe(onChange) {
      const h = (e) => e.key === KEY && onChange();
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
}
