import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRepo } from '../data/repo.js';
import { applyChanges } from '../data/merge.js';
import { DomainError } from '../lib/clinical.js';
import { AREAS, FAKE_IPS } from '../lib/constants.js';
import { currentThresholds } from './actions.js';

const StoreCtx = createContext(null);
const SESSION_KEY = 'sgc-session';

const readSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {};
  } catch {
    return {};
  }
};

export function StoreProvider({ children }) {
  const repo = useMemo(() => createRepo(), []);
  const [db, setDb] = useState(null);
  const [status, setStatus] = useState({ ok: true, msg: '' });
  const [session, setSession] = useState(readSession);
  const [toasts, setToasts] = useState([]);
  const dbRef = useRef(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const toast = useCallback((tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'crit' ? 8000 : 5000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const reload = useCallback(async () => {
    try {
      const next = await repo.load();
      dbRef.current = next;
      setDb(next);
      setStatus({ ok: true, msg: '' });
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    }
  }, [repo]);

  useEffect(() => {
    reload();
    return repo.subscribe(reload);
  }, [repo, reload]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* sin sessionStorage: la sesión dura lo que la pestaña */
    }
  }, [session]);

  const user = db && session.u ? db.users.find((x) => x.u === session.u && x.on) : null;
  const area = session.area || AREAS[0];

  /**
   * Ejecuta una acción de dominio: aplica los cambios en pantalla de inmediato
   * y luego los persiste. Devuelve { ok, result }.
   */
  const run = useCallback(
    async (action, ...args) => {
      const cur = dbRef.current;
      const ses = sessionRef.current;
      const u = cur?.users.find((x) => x.u === ses.u) || null;
      const ctx = { user: u, area: ses.area || AREAS[0], now: Date.now(), ip: FAKE_IPS[u?.u] || '192.168.1.40' };
      let res;
      try {
        res = action(cur, ctx, ...args);
      } catch (e) {
        if (e instanceof DomainError) {
          toast('crit', e.message);
          return { ok: false, error: e.message };
        }
        throw e;
      }
      dbRef.current = applyChanges(cur, res.changes);
      setDb(dbRef.current);
      if (res.toast) toast(...res.toast);
      try {
        await repo.save(res.changes);
        setStatus({ ok: true, msg: '' });
      } catch (e) {
        setStatus({ ok: false, msg: e.message });
        toast('crit', `No se pudo guardar en el servidor: ${e.message}`);
        reload();
        return { ok: false, error: e.message };
      }
      return { ok: true, result: res.result };
    },
    [repo, toast, reload],
  );

  const updateSession = useCallback((patch) => {
    const next = { ...sessionRef.current, ...patch };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const resetDemo = useCallback(async () => {
    try {
      const next = await repo.reset();
      dbRef.current = next;
      setDb(next);
      toast('info', 'Datos de demostración restablecidos.');
    } catch (e) {
      toast('crit', e.message);
    }
  }, [repo, toast]);

  const value = {
    db, repo, status, user, area, session, updateSession, run, toast, toasts, dismissToast, resetDemo,
    th: db ? currentThresholds(db) : null,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export const useStore = () => useContext(StoreCtx);
