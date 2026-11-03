import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { m } from 'motion/react';
import { Clock, FastForward, Pause, Play, RotateCcw, SkipForward, Square } from 'lucide-react';
import { StoreCtx, useStore } from '../store/useStore.js';
import { Shell } from './Shell.jsx';
import { Toasts } from './Toasts.jsx';
import { ESCENARIOS, crearSandbox, ejecutar, relojInicial } from '../lib/simulacion.js';
import { ABORTAR, SALTAR, actuar, cerrarDocumentos, crearControl, crearDriver } from '../lib/simGuion.js';
import { ahoraReal, fijarReloj } from '../lib/reloj.js';
import { detenerVivo } from '../lib/simVivo.js';
import { applyChanges } from '../data/merge.js';
import { DomainError, isCurrent } from '../lib/clinical.js';
import { AREAS } from '../lib/constants.js';
import { fmtHora } from '../lib/format.js';
import {
  assignCita, callNext, callTurn, cancelTurn, createTurn, currentThresholds, finishConsult, registerLatePayment, registerPayment,
  saveTriage, searchAudit, startConsult, startTriage,
} from '../store/actions.js';
import './simulador.css';

/* Las mismas pantallas del personal; se descargan al empezar para que no haya esperas a mitad del caso. */
const cargar = {
  adm: () => import('../views/Admision.jsx'),
  caj: () => import('../views/Caja.jsx'),
  enf: () => import('../views/Triaje.jsx'),
  med: () => import('../views/Consulta.jsx'),
};
const VISTAS = Object.fromEntries(Object.entries(cargar).map(([k, f]) => [k, lazy(f)]));
const SECCION = { adm: 'registro', caj: 'cobros', enf: 'lista', med: 'atencion' };

/** Estación de cada paso: nombre y color (el del rol que la atiende). */
const ESTACION = {
  adm: ['Admisión', 'adm'], caj: ['Caja', 'caj'], enf: ['Triaje', 'enf'], cita: ['Cita', 'adm'],
  med: ['Consulta', 'med'], alta: ['Alta', 'jef'], sis: ['Servicio SIS', 'warn'], red: ['Conexión', 'good'],
};

/**
 * Acción de dominio que corresponde a cada tipo de paso: cuando la pantalla la ejecuta (porque el cursor pulsó
 * el botón), la simulación entrega el resultado ya calculado del paso, con las reglas reales del sistema.
 */
const ACEPTA = {
  buscar: [searchAudit], registrar: [createTurn], cobrar: [registerPayment, registerLatePayment], llamar: [callTurn, callNext],
  rellamar: [callTurn], iniciar: [startTriage, startConsult], triaje: [saveTriage], cita: [assignCita], consulta: [finishConsult],
  noShow: [cancelTurn],
};
const LECTURA_MS = 3200;
/** Tiempo extra cuando el paso abre un documento (ticket, boleta, constancia o receta), para alcanzar a verlo. */
const DOCUMENTO_MS = 2800;
const noop = () => {};

/**
 * Simulación en vivo: reproduce un caso en las pantallas reales de cada estación (Admisión, Caja, Triaje y
 * Consulta), con un cursor que escribe los datos y pulsa los botones. Trabaja sobre una copia de prueba: no
 * cambia la base real. Arriba queda una barra para pausar, saltar o detener.
 */
export default function SimEnVivo({ k }) {
  const real = useStore();
  const esc = ESCENARIOS.find((e) => e.k === k) ?? ESCENARIOS[0];
  const [nonce, setNonce] = useState(0);
  const reloj = useMemo(() => relojInicial(ahoraReal()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => crearSandbox(reloj), [reloj]);
  const fotos = useMemo(() => ejecutar(esc, base, reloj), [esc, base, reloj]);

  const [db, setDb] = useState(base);
  const dbRef = useRef(base);
  const [i, setI] = useState(0);
  const [quien, setQuien] = useState(fotos[0].quien);
  const [area, setArea] = useState(AREAS[0]);
  const [status, setStatus] = useState({ ok: true, msg: '' });
  const [toasts, setToasts] = useState([]);
  const [pausa, setPausa] = useState(false);
  const [rapido, setRapido] = useState(false);
  const [fin, setFin] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [clic, setClic] = useState(0);
  const [nota, setNota] = useState(null);
  const ctlRef = useRef(null);
  const pasoRef = useRef({ aplicado: true, acepta: [] });
  const raizRef = useRef(null);
  const barRef = useRef(null);
  const ctxRef = useRef({ quien, area });
  useEffect(() => {
    ctxRef.current = { quien, area };
  }, [quien, area]);

  const toast = useCallback((tone, text) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'crit' ? 8000 : 5000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const ponerDb = useCallback((next) => {
    dbRef.current = next;
    setDb(next);
  }, []);

  /** Resultado del paso tal como lo calculó el sistema (aviso, rechazo o falla de guardado). */
  const aplicar = useCallback((f) => {
    if (f.error) {
      if (f.paso.falla) {
        setStatus({ ok: false, msg: f.error });
        toast('crit', `No se guardó: ${f.error}`);
      } else {
        toast('crit', f.error);
      }
      return { ok: false, error: f.error };
    }
    ponerDb(f.db);
    if (f.toast) toast(...f.toast);
    return { ok: true, result: f.result };
  }, [ponerDb, toast]);

  /**
   * `run` de la copia de prueba. La acción del paso devuelve el resultado calculado; cualquier otra (por ejemplo,
   * si el presentador pulsa algo en una pausa) se ejecuta de verdad sobre la copia.
   */
  const run = useCallback(async (action, ...args) => {
    const p = pasoRef.current;
    if (!p.aplicado && p.acepta.includes(action)) {
      p.aplicado = true;
      return aplicar(p.foto);
    }
    const { quien: u, area: a } = ctxRef.current;
    let res;
    try {
      res = action(dbRef.current, { user: u, area: a, now: Date.now(), ip: '' }, ...args);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      toast('crit', e.message);
      return { ok: false, error: e.message };
    }
    ponerDb(applyChanges(dbRef.current, res.changes));
    if (res.toast) toast(...res.toast);
    return { ok: true, result: res.result };
  }, [aplicar, ponerDb, toast]);

  // Mientras dura: reloj del caso, sesión real en pausa y pantallas descargadas. Al salir, todo vuelve.
  useEffect(() => {
    Object.values(cargar).forEach((f) => f());
    real.repo.pausarSesion?.(true);
    return () => {
      fijarReloj(null);
      real.repo.pausarSesion?.(false);
    };
  }, [real.repo]);

  // Altura de la barra: las pantallas se acomodan debajo
  useEffect(() => {
    const el = barRef.current;
    const ro = new ResizeObserver(() => el.parentElement.style.setProperty('--simh', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reproducción: paso por paso, el cursor actúa en la pantalla y luego queda un momento para leer
  useEffect(() => {
    const ctl = crearControl();
    ctl.velocidad = rapido ? 2 : 1;
    ctlRef.current = ctl;
    const ui = {
      cursor: (x, y) => setCursor({ x, y }),
      clic: () => setClic((n) => n + 1),
      nota: (rect, msg) => setNota(rect ? { rect, msg } : null),
    };
    (async () => {
      let anterior = base;
      let rolAntes = null;
      for (const [n, f] of fotos.entries()) {
        pasoRef.current = { aplicado: !f.paso.accion, acepta: ACEPTA[f.paso.ui?.tipo] ?? [], foto: f };
        fijarReloj(f.now);
        ponerDb(anterior);
        setI(n);
        if (f.quien) setQuien(f.quien);
        // Otra estación: su pantalla se ve desde arriba
        if (f.quien && f.quien.role !== rolAntes) {
          rolAntes = f.quien.role;
          window.scrollTo({ top: 0 });
        }
        if (f.area) setArea(f.area);
        if (f.paso.conexion === 'red') {
          setStatus({ ok: false, msg: 'El equipo no tiene conexión a internet.' });
          toast('crit', 'Sin conexión a internet: los cambios no se guardarán hasta que vuelva la red.');
        }
        if (f.paso.st === 'red') {
          setStatus({ ok: true, msg: '' });
          toast('ok', 'Conexión restablecida. Datos actualizados.');
        }
        let saltado = false;
        try {
          await ctl.espera(900);
          const raiz = raizRef.current;
          if (f.paso.ui) await cerrarDocumentos(raiz, crearDriver(raiz, ctl, ui), ctl);
          await actuar(raiz, ctl, ui, f, { alergia: f.paciente?.alg ?? '' });
          // El botón llama a la acción de forma asíncrona: se espera a que la pantalla la ejecute
          for (let t = 0; t < 2500 && !pasoRef.current.aplicado; t += 100) await ctl.espera(100);
        } catch (e) {
          if (e === ABORTAR) return;
          if (e !== SALTAR) throw e;
          ctl.saltar = false;
          saltado = true;
        }
        // Si la pantalla no llegó a ejecutarla, el paso se aplica igual: la simulación nunca queda a medias
        if (!pasoRef.current.aplicado) {
          pasoRef.current.aplicado = true;
          aplicar(f);
        }
        anterior = f.db;
        if (f.inesperado) {
          setFin('inesperado');
          return;
        }
        try {
          // «Siguiente» pasa de inmediato; si no, queda un momento para leer (más si se abrió un documento)
          await ctl.espera(saltado ? 400 : 300);
          if (!saltado) await ctl.espera(LECTURA_MS + (raizRef.current.querySelector('.dialog') ? DOCUMENTO_MS : 0));
        } catch (e) {
          if (e === ABORTAR) return;
          ctl.saltar = false;
        }
      }
      setFin('ok');
    })().catch((e) => {
      if (e !== ABORTAR) console.error(e);
    });
    return () => {
      ctl.abortado = true;
    };
  }, [nonce, fotos, base, aplicar, ponerDb, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = fotos[i];
  const user = quien ?? fotos[0].quien;
  const rol = user.role;
  const Vista = VISTAS[rol];
  const [estNombre, estRol] = ESTACION[f.paso.st];
  const salir = useCallback(() => detenerVivo(), []);
  const patients = useMemo(() => new Map(db.patients.map((p) => [p.dni, p])), [db.patients]);
  const repo = useMemo(() => ({
    kind: 'sim',
    label: 'Simulación · datos de prueba',
    historia: async (dni) => dbRef.current.turns.filter((t) => t.dni === dni).sort((a, b) => b.t0 - a.t0),
    cupos: async () => [],
    reservarCita: async () => { throw new Error('No disponible en la simulación.'); },
  }), []);
  // Como en el servidor, la estación carga solo los turnos de hoy y los abiertos; la historia se pide aparte
  const ahora = f.now;
  const vista = useMemo(() => ({ ...db, turns: db.turns.filter((t) => isCurrent(t, ahora)), me: { username: user.u } }), [db, ahora, user.u]);
  const value = useMemo(() => ({
    db: vista, repo, patient: (dni) => patients.get(dni), status, auth: { u: user.u }, user, area,
    prefs: {}, updatePrefs: noop, run, toast, toasts, dismissToast, resetDemo: noop, signIn: noop, signOut: salir,
    changePassword: noop, idleLeft: null, reload: noop, th: currentThresholds(db),
  }), [vista, db, repo, patients, status, user, area, run, toast, toasts, dismissToast, salir]);

  const pausar = () => {
    const ctl = ctlRef.current;
    ctl.pausa = !ctl.pausa;
    setPausa(ctl.pausa);
  };
  const saltar = () => {
    ctlRef.current.pausa = false;
    ctlRef.current.saltar = true;
    setPausa(false);
  };
  const cambiarVelocidad = () => {
    ctlRef.current.velocidad = rapido ? 1 : 2;
    setRapido(!rapido);
  };
  const reiniciar = () => {
    setCursor(null);
    setNota(null);
    setFin(null);
    setPausa(false);
    setStatus({ ok: true, msg: '' });
    setToasts([]);
    setNonce((x) => x + 1);
  };

  return (
    <div className="simv">
      <div className={`simv-bar ${fin === 'ok' ? 'ok' : ''}`} ref={barRef} role="region" aria-label="Simulación en vivo">
        <div className="simv-id">
          <span className="simv-live"><i aria-hidden="true" /> {fin === 'ok' ? 'Caso completo' : fin ? 'Detenida' : pausa ? 'En pausa' : 'En vivo'}</span>
          <b>{esc.titulo}</b>
          <small><Clock aria-hidden="true" /> {fmtHora(f.now)} · datos de prueba</small>
        </div>
        <div className="simv-paso" data-role={f.error && f.paso.falla ? 'crit' : estRol}>
          <span className="sim-tag">{estNombre}</span>
          <m.div key={`${nonce}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <b>Paso {i + 1} de {fotos.length}: {f.paso.titulo}{f.quien ? <span className="simv-quien"> · {f.quien.n}</span> : null}</b>
            <p>{fin === 'inesperado' ? `La simulación se detuvo aquí: ${f.error}` : f.texto}</p>
          </m.div>
        </div>
        <div className="simv-ctl">
          <div className="sim-dots" aria-hidden="true">
            {fotos.map((x, n) => <span key={n} className={`${n === i ? 'on' : ''} ${n < i ? 'done' : ''} ${x.error ? 'bad' : ''}`} />)}
          </div>
          <div className="simv-btns">
            {fin ? (
              <button type="button" className="btn sm" onClick={reiniciar}><RotateCcw /> Repetir</button>
            ) : (
              <>
                <button type="button" className="btn sm" onClick={pausar}>{pausa ? <><Play /> Continuar</> : <><Pause /> Pausar</>}</button>
                <button type="button" className="btn sec sm" onClick={saltar} title="Terminar este paso y pasar al siguiente"><SkipForward /> Siguiente</button>
                <button type="button" className="btn sec sm" aria-pressed={rapido} onClick={cambiarVelocidad} title="Velocidad"><FastForward /> {rapido ? '2×' : '1×'}</button>
                <button type="button" className="icon-btn sm" onClick={reiniciar} aria-label="Reiniciar el caso" title="Reiniciar el caso"><RotateCcw /></button>
              </>
            )}
            <button type="button" className="btn dng-solid sm" onClick={salir}><Square /> Detener</button>
          </div>
        </div>
      </div>

      <StoreCtx.Provider value={value}>
        <div className="simv-app" ref={raizRef}>
          <Shell section={SECCION[rol]}>
            <div className="view">
              <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
                <Vista key={rol} />
              </Suspense>
            </div>
          </Shell>
        </div>
        <Toasts />
      </StoreCtx.Provider>

      {nota && (
        <div className="simv-nota" style={{ left: Math.max(12, Math.min(nota.rect.left, window.innerWidth - 300)), top: nota.rect.bottom + 10 }}>
          {nota.msg}
        </div>
      )}
      {cursor && (
        <div className="simv-cursor" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.8L4 20z" /></svg>
          <span key={clic} className="simv-clic" />
        </div>
      )}
    </div>
  );
}
