import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StoreCtx } from './useStore.js';
import { createRepo } from '../data/repo.js';
import { applyChanges } from '../data/merge.js';
import { DomainError } from '../lib/clinical.js';
import { AREAS, IDLE_MS, IDLE_WARN_MS } from '../lib/constants.js';
import { currentThresholds, loginAudit, logoutAudit } from './actions.js';

const PREFS_KEY = 'sgc-prefs';

const readPrefs = () => {
  try {
    return JSON.parse(sessionStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
};

export function StoreProvider({ children }) {
  const repo = useMemo(() => createRepo(), []);
  const [auth, setAuth] = useState(undefined); // undefined: comprobando · null: sin sesión · { u, mustChange }
  const [db, setDb] = useState(null);
  const [status, setStatus] = useState({ ok: true, msg: '' });
  const [prefs, setPrefs] = useState(readPrefs);
  const [toasts, setToasts] = useState([]);
  const [idleLeft, setIdleLeft] = useState(null);
  const dbRef = useRef(null);
  const prefsRef = useRef(prefs);
  const pendingLogin = useRef(false);
  // Cada carga lleva un número: si llega una respuesta de una carga anterior (o iniciada antes de un
  // cambio local), se descarta para no pisar datos más nuevos.
  const loadSeq = useRef(0);

  const toast = useCallback((tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'crit' ? 8000 : 5000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* ---------- Sesión ---------- */
  useEffect(() => {
    let alive = true;
    repo.getSession().then((a) => alive && setAuth(a)).catch(() => alive && setAuth(null));
    const off = repo.onAuthChange((a) => {
      // Sesión cerrada (otra pestaña o expiración): los datos del usuario anterior se descartan de inmediato
      if (!a) {
        dbRef.current = null;
        setDb(null);
      }
      setAuth((cur) => (JSON.stringify(cur) === JSON.stringify(a) ? cur : a));
    });
    return () => {
      alive = false;
      off();
    };
  }, [repo]);

  const reload = useCallback(() => {
    const seq = ++loadSeq.current;
    return repo.load().then(
      (next) => {
        if (seq !== loadSeq.current) return;
        dbRef.current = next;
        setDb(next);
        setStatus({ ok: true, msg: '' });
      },
      (e) => seq === loadSeq.current && setStatus({ ok: false, msg: e.message }),
    );
  }, [repo]);

  // Los datos solo se cargan con sesión y sin contraseña temporal pendiente: cada rol recibe lo que puede ver.
  const authed = !!auth?.u && !auth.mustChange;
  useEffect(() => {
    if (!authed) return undefined;
    reload();
    return repo.subscribe(reload);
  }, [authed, repo, reload]);

  useEffect(() => {
    try {
      sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* sin sessionStorage */
    }
  }, [prefs]);

  const user = db && auth?.u ? db.users.find((x) => x.u === auth.u && x.on) || null : null;
  const patients = useMemo(() => new Map((db?.patients || []).map((p) => [p.dni, p])), [db?.patients]);
  const patient = useCallback((dni) => patients.get(dni), [patients]);
  const area = prefs.area || AREAS[0];

  /**
   * Ejecuta una acción de dominio: aplica los cambios en pantalla de inmediato
   * y luego los persiste. Devuelve { ok, result }.
   */
  const run = useCallback(
    async (action, ...args) => {
      const cur = dbRef.current;
      const u = cur?.users.find((x) => x.u === cur?.me?.username) || null;
      const ctx = { user: u, area: prefsRef.current.area || AREAS[0], now: Date.now(), ip: '' };
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
      loadSeq.current++; // una carga en curso ya no refleja este cambio
      dbRef.current = applyChanges(cur, res.changes);
      setDb(dbRef.current);
      try {
        await repo.save(res.changes);
        setStatus({ ok: true, msg: '' });
      } catch (e) {
        setStatus({ ok: false, msg: e.message });
        toast('crit', `No se guardó: ${e.message}`);
        reload();
        return { ok: false, error: e.message };
      }
      if (res.toast) toast(...res.toast);
      return { ok: true, result: res.result };
    },
    [repo, toast, reload],
  );

  // Auditoría del inicio de sesión, cuando ya se cargaron los datos
  useEffect(() => {
    if (user && pendingLogin.current) {
      pendingLogin.current = false;
      run(loginAudit);
    }
  }, [user, run]);

  const signIn = useCallback(
    async (u, p) => {
      const a = await repo.signIn(u, p);
      pendingLogin.current = true;
      setAuth(a);
      return a;
    },
    [repo],
  );

  const signOut = useCallback(
    async (reason) => {
      if (dbRef.current?.me) await run(logoutAudit).catch(() => {});
      await repo.signOut().catch(() => {});
      dbRef.current = null;
      setDb(null);
      setAuth(null);
      setIdleLeft(null);
      if (reason) toast('info', reason);
    },
    [repo, run, toast],
  );

  const changePassword = useCallback(
    async (p) => {
      await repo.changePassword(p); // el repositorio registra el cambio en la auditoría
      setAuth((a) => (a ? { ...a, mustChange: false } : a));
      toast('ok', 'Contraseña actualizada.');
    },
    [repo, toast],
  );

  /* ---------- Cierre por inactividad ---------- */
  useEffect(() => {
    if (!authed) return undefined;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(() => {
      const left = IDLE_MS - (Date.now() - last);
      if (left <= 0) signOut('Sesión cerrada por inactividad.');
      else setIdleLeft(left <= IDLE_WARN_MS ? left : null);
    }, 5000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(id);
    };
  }, [authed, signOut]);

  const updatePrefs = useCallback((patch) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
  }, []);

  const resetDemo = useCallback(async () => {
    try {
      // La semilla (varias semanas de datos) solo se descarga cuando Jefatura la pide.
      const { buildSeed } = await import('../lib/seed.js');
      const next = await repo.reset(buildSeed());
      dbRef.current = next;
      setDb(next);
      toast('info', 'Datos de demostración restablecidos.');
    } catch (e) {
      toast('crit', e.message);
    }
  }, [repo, toast]);

  const value = {
    db: authed ? db : null, repo, patient, status, auth, user, area, prefs, updatePrefs, run, toast, toasts, dismissToast, resetDemo,
    signIn, signOut, changePassword, idleLeft,
    th: db ? currentThresholds(db) : null,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

