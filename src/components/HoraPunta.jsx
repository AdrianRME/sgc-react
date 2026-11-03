import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, FastForward, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { StoreCtx, useStore } from '../store/useStore.js';
import { Shell } from './Shell.jsx';
import { Toasts } from './Toasts.jsx';
import { PrioBadge } from './ui.jsx';
import { crearSandbox, relojInicial } from '../lib/simulacion.js';
import { simularHoraPunta } from '../lib/horaPunta.js';
import { ahoraReal, fijarReloj } from '../lib/reloj.js';
import { detenerVivo, iniciarVivo } from '../lib/simVivo.js';
import { currentThresholds } from '../store/actions.js';
import { fmtHora } from '../lib/format.js';
import './simulador.css';

const Flujo = lazy(() => import('../views/Flujo.jsx'));
const Sala = lazy(() => import('../views/Sala.jsx'));
const VELOCIDADES = [[1, '1×'], [2, '2×'], [4, '4×']];
const CANTIDADES = [15, 20, 30];
/** Milisegundos reales por minuto simulado a velocidad 1×: una hora de atención en un minuto. */
const MS_MINUTO = 1000;
const noop = () => {};

const ETAPAS = [
  ['Caja', (t) => t.state === 'PENDIENTE_PAGO'],
  ['Triaje', (t) => ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'].includes(t.state)],
  ['Esperan consulta', (t) => ['PENDIENTE_CITA', 'EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA'].includes(t.state)],
  ['En consulta', (t) => t.state === 'EN_CONSULTA'],
  ['Atendidos', (t) => t.state === 'ATENDIDO'],
];

/**
 * Hora punta: muchos pacientes llegan en una hora y el centro los atiende con las reglas reales, sobre una copia de
 * prueba. Se ve en el flujo en vivo de Jefatura (o en la pantalla de sala) con el reloj acelerado; arriba quedan los
 * contadores por estación y los controles. Al terminar compara la espera real con la que estimaba el modelo de ML.
 */
export default function HoraPunta({ pacientes = 20 }) {
  const real = useStore();
  const reloj = useMemo(() => relojInicial(ahoraReal()), []);
  const base = useMemo(() => crearSandbox(reloj), [reloj]);
  const sim = useMemo(() => simularHoraPunta(base, reloj, { pacientes }), [base, reloj, pacientes]);
  const { fotos, resumen } = sim;
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const [vel, setVel] = useState(1);
  const [vista, setVista] = useState('flujo');
  const barRef = useRef(null);
  const f = fotos[i];
  const fin = i === fotos.length - 1;

  // Reloj del caso y sesión real en pausa mientras dura
  useEffect(() => {
    real.repo.pausarSesion?.(true);
    return () => {
      fijarReloj(null);
      real.repo.pausarSesion?.(false);
    };
  }, [real.repo]);
  useEffect(() => {
    fijarReloj(f.now);
  }, [f.now]);

  useEffect(() => {
    if (pausa || fin) return undefined;
    const id = setTimeout(() => setI((x) => Math.min(fotos.length - 1, x + 1)), MS_MINUTO / vel);
    return () => clearTimeout(id);
  }, [i, pausa, fin, vel, fotos.length]);

  useEffect(() => {
    const el = barRef.current;
    const ro = new ResizeObserver(() => el.parentElement.style.setProperty('--simh', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hoy = f.db.turns.filter((t) => t.t0 >= reloj);
  const llegaron = hoy.length;
  const eventos = useMemo(() => fotos.slice(0, i + 1).flatMap((x) => x.eventos.map((e) => `${fmtHora(x.now)} · ${e}`)).slice(-3).reverse(), [fotos, i]);

  const salir = useCallback(() => detenerVivo(), []);
  const user = base.users.find((u) => u.u === 'j.jefatura');
  const patients = useMemo(() => new Map(f.db.patients.map((p) => [p.dni, p])), [f.db.patients]);
  const repo = useMemo(() => ({
    kind: 'sim',
    label: 'Simulación · datos de prueba',
    historia: async () => [],
    indicadores: async () => [],
    sala: async () => [],
  }), []);
  const value = useMemo(() => ({
    db: { ...f.db, turns: f.db.turns.filter((t) => t.t0 >= reloj || !['ATENDIDO', 'CANCELADO'].includes(t.state)), me: { username: user.u } },
    repo, patient: (dni) => patients.get(dni), status: { ok: true, msg: '' }, auth: { u: user.u }, user, area: 'Consultorio 1',
    prefs: {}, updatePrefs: noop, run: async () => ({ ok: false }), toast: noop, toasts: [], dismissToast: noop, resetDemo: noop,
    signIn: noop, signOut: salir, changePassword: noop, idleLeft: null, reload: noop, th: currentThresholds(f.db),
  }), [f.db, reloj, user, repo, patients, salir]);

  const reiniciar = () => {
    setI(0);
    setPausa(false);
  };

  return (
    <div className="simv">
      <div className={`simv-bar hp-bar ${fin ? 'ok' : ''}`} ref={barRef} role="region" aria-label="Hora punta">
        <div className="simv-id">
          <span className="simv-live"><i aria-hidden="true" /> {fin ? 'Hora punta completa' : pausa ? 'En pausa' : 'En vivo'}</span>
          <b>Hora punta: {pacientes} pacientes en 1 hora</b>
          <small><Clock aria-hidden="true" /> {fmtHora(f.now)} · minuto {f.m} · datos de prueba</small>
        </div>
        <div className="hp-centro">
          <div className="hp-cont">
            <span className="hp-c"><b>{llegaron}/{sim.llegadas}</b><small>Llegaron</small></span>
            {ETAPAS.map(([n, of]) => <span className="hp-c" key={n}><b>{hoy.filter(of).length}</b><small>{n}</small></span>)}
            <span className="hp-c"><b>{hoy.filter((t) => t.state === 'CITADO').length}</b><small>Cita otro día</small></span>
          </div>
          <ul className="hp-ev" aria-live="polite">{eventos.map((e, n) => <li key={`${i}-${n}`}>{e}</li>)}</ul>
        </div>
        <div className="simv-ctl">
          <div className="simv-btns">
            <span className="hp-seg" role="group" aria-label="Vista">
              <button type="button" aria-pressed={vista === 'flujo'} onClick={() => setVista('flujo')}>Flujo</button>
              <button type="button" aria-pressed={vista === 'sala'} onClick={() => setVista('sala')}>Sala</button>
            </span>
            <span className="hp-seg" role="group" aria-label="Pacientes">
              {CANTIDADES.map((n) => <button key={n} type="button" aria-pressed={n === pacientes} onClick={() => iniciarVivo(`hora-punta:${n}`)}>{n}</button>)}
            </span>
          </div>
          <div className="simv-btns">
            {fin
              ? <button type="button" className="btn sm" onClick={reiniciar}><RotateCcw /> Repetir</button>
              : <button type="button" className="btn sm" onClick={() => setPausa(!pausa)}>{pausa ? <><Play /> Continuar</> : <><Pause /> Pausar</>}</button>}
            <button type="button" className="btn sec sm" onClick={() => setVel(VELOCIDADES[(VELOCIDADES.findIndex(([v]) => v === vel) + 1) % VELOCIDADES.length][0])} title="Velocidad">
              <FastForward /> {VELOCIDADES.find(([v]) => v === vel)[1]}
            </button>
            <button type="button" className="btn dng-solid sm" onClick={salir}><Square /> Detener</button>
          </div>
        </div>
      </div>

      <StoreCtx.Provider value={value}>
        <div className="simv-app">
          <Shell section={vista}>
            <div className="view">
              <Suspense fallback={<div className="skeleton" style={{ height: 320 }} />}>
                {vista === 'flujo' ? <Flujo /> : <Sala />}
              </Suspense>
            </div>
          </Shell>
        </div>
        <Toasts />
      </StoreCtx.Provider>

      {fin && <Resumen r={resumen} />}
    </div>
  );
}

const n1 = (x) => (x == null ? '—' : x.toLocaleString('es-PE', { maximumFractionDigits: 1 }));

/** Cifras finales y la espera real de cada paciente frente a la estimada por el modelo de ML. */
function Resumen({ r }) {
  const [abierto, setAbierto] = useState(true);
  if (!abierto) return null;
  return (
    <div className="hp-res" role="dialog" aria-label="Resultado de la hora punta">
      <button type="button" className="icon-btn sm dialog-x" onClick={() => setAbierto(false)} aria-label="Cerrar">×</button>
      <h3>Resultado de la hora punta</h3>
      <div className="ml-kpis">
        <div className="ml-kpi"><small>Atendidos el mismo día</small><b>{r.atendidos} de {r.llegaron}</b></div>
        <div className="ml-kpi"><small>Con cita otro día (sin cupo hoy)</small><b>{r.citadosOtroDia}</b></div>
        <div className="ml-kpi"><small>Espera media hasta la consulta</small><b>{n1(r.esperaMedia)} min</b></div>
        <div className="ml-kpi"><small>Duración de la jornada simulada</small><b>{r.duracion} min</b></div>
      </div>
      {r.comparados.length > 0 && (
        <>
          <p className="hp-nota">
            Espera real frente a la que estimó el modelo de ML al llegar cada paciente (sección «Predicción con ML»). Error medio: <b>{n1(r.mae)} min</b>.
            El modelo aprendió con el historial de días normales; en esta hora punta {r.sesgo >= 0 ? 'sobreestimó' : 'subestimó'} la espera en {n1(Math.abs(r.sesgo))} min
            en promedio. Con datos reales de horas punta habría que reentrenarlo.
          </p>
          <div className="tblw hp-tbl">
            <table className="tbl">
              <thead><tr><th>Turno</th><th>Prioridad</th><th className="num">Espera real</th><th className="num">Estimada (ML)</th></tr></thead>
              <tbody>
                {r.comparados.map((x) => (
                  <tr key={x.id}><td>{x.id}</td><td><PrioBadge prio={x.prio} /></td><td className="num">{Math.round(x.real)} min</td><td className="num">{Math.round(x.ml)} min</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
