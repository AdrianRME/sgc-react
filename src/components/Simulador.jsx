import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ChevronLeft, ChevronRight, Clock, Pause, Play, RotateCcw, Server, ServerCrash, ShieldAlert, Tv, WifiOff } from 'lucide-react';
import { ESCENARIOS, crearSandbox, ejecutar, relojInicial } from '../lib/simulacion.js';
import { ROUTE } from '../lib/constants.js';
import { fmtHora, fmtLongDay, fmtSoles, fullName } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { Modal } from './Modal.jsx';
import { Icon3D } from './Icon3D.jsx';
import { Msg, PrioBadge, SisBadge, StateBadge, TurnCode } from './ui.jsx';
import './simulador.css';

/** Estación de cada paso: nombre y color (el del rol que la atiende). */
const ESTACION = {
  adm: ['Admisión', 'adm'], caj: ['Caja', 'caj'], enf: ['Triaje', 'enf'], cita: ['Cita', 'adm'],
  med: ['Consulta', 'med'], alta: ['Alta', 'jef'], sis: ['Servicio SIS', 'warn'], red: ['Conexión', 'good'],
};
const CONEXION = {
  ok: ['Servidor en línea', 'good', Server],
  servidor: ['El servidor no responde', 'crit', ServerCrash],
  red: ['Sin conexión a internet', 'crit', WifiOff],
  sis: ['El SIS no responde', 'warn', ShieldAlert],
};
const AUTO_MS = 4500;
/** Color del punto de cada paso en la barra de progreso. */
const colorDe = (st) => (st === 'sis' ? 'var(--warn)' : st === 'red' ? 'var(--good)' : `var(--st-${ESTACION[st][1]})`);

/** Ficha del turno tal como queda después del paso. */
function Ficha({ f }) {
  const t = f.turno;
  if (!t) {
    return (
      <div className="sim-ficha empty">
        <Icon3D name="idcard" size={40} />
        <p>Todavía no hay turno: el paciente está en la ventanilla de Admisión.</p>
      </div>
    );
  }
  const p = f.paciente;
  return (
    <div className="sim-ficha">
      <div className="sim-ficha-h">
        <TurnCode id={t.id} className="big" />
        <div>
          <b>{fullName(p)}</b>
          <small>{p.hc} · DNI {p.dni}{p.alg ? ` · alergia: ${p.alg}` : ''}</small>
        </div>
      </div>
      <div className="sim-badges">
        <StateBadge state={t.state} />
        {t.prio && <PrioBadge prio={t.prio} />}
        <SisBadge sis={p.sis} />
      </div>
      <dl className="sim-datos">
        <div><dt>Pago</dt><dd>{t.pago ? (t.pago.metodo === 'SIS' ? 'Exonerado por SIS (S/ 0.00)' : `${fmtSoles(t.pago.monto)} · boleta ${t.pago.comp}`) : t.state === 'PENDIENTE_PAGO' ? 'Pendiente en Caja' : '—'}</dd></div>
        <div><dt>Triaje</dt><dd>{t.tri ? `PA ${t.tri.pa} · FC ${t.tri.fc} · SpO₂ ${t.tri.spo2} % · T ${t.tri.t} °C` : '—'}</dd></div>
        <div><dt>Cita</dt><dd>{f.cita || '—'}</dd></div>
        <div><dt>Atención</dt><dd>{t.consult ? `${t.consult.dx.map((d) => d[0]).join(', ')} · ${t.consult.dest}${t.consult.destx ? ` (${t.consult.destx})` : ''} · receta ${t.consult.rec}` : t.cancel ? `Cerrado: ${t.cancel.motivo}` : '—'}</dd></div>
      </dl>
    </div>
  );
}

/** Lo que el sistema respondió en el paso: aviso, rechazo o falla de guardado. */
function Respuesta({ f }) {
  if (f.inesperado) return <Msg tone="warn"><b>La simulación se detuvo aquí.</b> {f.error} Pruebe otro caso o vuelva a abrir el simulador otro día.</Msg>;
  if (f.error && f.paso.rechazo) return <Msg tone="warn"><b>El sistema lo impide.</b> {f.error}</Msg>;
  if (f.error) return <Msg tone="crit"><b>No se guardó:</b> {f.error} La pantalla vuelve al último dato guardado.</Msg>;
  if (f.toast) return <Msg tone={f.toast[0] === 'crit' ? 'crit' : f.toast[0] === 'info' ? 'info' : 'ok'}>{f.toast[1]}</Msg>;
  return null;
}

/**
 * Simulador del ciclo del paciente: recorre paso a paso cada escenario con las reglas reales del sistema,
 * sobre una copia de prueba de los datos (no cambia la base real ni requiere conexión).
 */
export default function Simulador({ onClose }) {
  const reloj = useMemo(() => relojInicial(), []);
  const base = useMemo(() => crearSandbox(reloj), [reloj]);
  const [k, setK] = useState(ESCENARIOS[0].k);
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(false);
  const esc = ESCENARIOS.find((e) => e.k === k);
  const fotos = useMemo(() => ejecutar(esc, base, reloj), [esc, base, reloj]);
  const f = fotos[i];
  const last = i === fotos.length - 1;
  const [estNombre, estRol] = ESTACION[f.paso.st];
  const [conTxt, conTone, ConIcon] = CONEXION[f.conexion];
  const etapa = f.turno ? ROUTE.findIndex((s) => s.states.includes(f.turno.state)) : f.paso.st === 'adm' ? 0 : -1;
  const cerrado = f.turno?.state === 'CANCELADO';

  const elegir = (key) => {
    setK(key);
    setI(0);
    setAuto(false);
  };
  const ir = (n) => setI(Math.max(0, Math.min(fotos.length - 1, n)));

  // La reproducción automática se detiene sola en el último paso
  const playing = auto && !last;
  useEffect(() => {
    if (!playing) return undefined;
    const id = setTimeout(() => setI((x) => x + 1), AUTO_MS);
    return () => clearTimeout(id);
  }, [playing, i]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(fotos.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fotos.length]);

  return (
    <Modal label="Simulador del ciclo del paciente" onClose={onClose} className="sim">
      <header className="sim-h">
        <Icon3D name="sparkles" size={44} />
        <div>
          <h3>Simulador del ciclo del paciente</h3>
          <p>Recorra cada caso paso a paso. Usa las mismas reglas del sistema sobre una copia de prueba: no cambia los datos reales.</p>
        </div>
      </header>

      <div className="sim-body">
        <nav className="sim-esc" aria-label="Casos para simular">
          {ESCENARIOS.map((e) => (
            <button key={e.k} type="button" className="sim-esc-b" aria-pressed={e.k === k} onClick={() => elegir(e.k)}>
              <Icon3D name={e.icon} size={30} />
              <span><b>{e.titulo}</b><small>{e.resumen}</small></span>
            </button>
          ))}
        </nav>

        <section className="sim-main" aria-live="polite">
          <div className="sim-top">
            <ol className="sim-route" aria-label="Ruta del paciente">
              {ROUTE.map((s, n) => (
                <li
                  key={s.k}
                  className={cerrado ? (n <= Math.max(etapa, 0) ? 'off' : '') : n < etapa ? 'done' : n === etapa ? 'now' : ''}
                  style={{ '--c': `var(--st-${s.c})` }}
                >
                  <i aria-hidden="true" />
                  <span>{s.n}</span>
                </li>
              ))}
            </ol>
            <span className={`sim-con ${conTone}`}><ConIcon aria-hidden="true" /> {conTxt}</span>
          </div>

          <div className="sim-step" data-role={f.error && f.paso.falla ? 'crit' : estRol}>
            <div className="sim-step-h">
              <span className="sim-tag">{estNombre}</span>
              <span>Paso {i + 1} de {fotos.length}{f.quien ? ` · ${f.quien.n}` : ''}</span>
              <span className="sim-clock" title={fmtLongDay(f.now)}><Clock aria-hidden="true" /> {fmtHora(f.now)}</span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <m.div key={`${k}-${i}`} {...listItem} className="sim-step-c">
                <h4>{f.paso.titulo}</h4>
                <p>{f.texto}</p>
                <Respuesta f={f} />
              </m.div>
            </AnimatePresence>
          </div>

          <div className="sim-grid">
            <Ficha f={f} />
            <div className="sim-log">
              <h5>Queda registrado</h5>
              {f.sala && <p className="sim-sala"><Tv aria-hidden="true" /> Pantalla de sala: <b>{f.sala}</b></p>}
              {f.audit.length ? (
                <ul>
                  {f.audit.map((a) => <li key={a.id}><span className="code">{fmtHora(a.t)}</span> <b>{a.a}</b> {a.d}</li>)}
                </ul>
              ) : <p className="note">{f.error ? 'Nada: el cambio no llegó a guardarse.' : 'Sin registros en este paso.'}</p>}
            </div>
          </div>

          <footer className="sim-ctl">
            <div className="sim-dots" role="group" aria-label="Pasos">
              {fotos.map((x, n) => (
                <button
                  key={n}
                  type="button"
                  className={`${n === i ? 'on' : ''} ${x.error ? 'bad' : ''}`}
                  style={{ '--c': colorDe(x.paso.st) }}
                  aria-label={`Paso ${n + 1}: ${x.paso.titulo}`}
                  aria-current={n === i ? 'step' : undefined}
                  onClick={() => ir(n)}
                />
              ))}
            </div>
            <div className="sim-btns">
              <button type="button" className="btn sec" onClick={() => ir(i - 1)} disabled={i === 0}><ChevronLeft /> Anterior</button>
              <button type="button" className="btn sec" onClick={() => (last ? (setI(0), setAuto(true)) : setAuto(!playing))}>
                {playing ? <><Pause /> Pausar</> : <><Play /> Reproducir</>}
              </button>
              {last
                ? <button type="button" className="btn" onClick={() => elegir(k)}><RotateCcw /> Reiniciar</button>
                : <button type="button" className="btn" onClick={() => ir(i + 1)}>Siguiente <ChevronRight /></button>}
            </div>
          </footer>
        </section>
      </div>
    </Modal>
  );
}
