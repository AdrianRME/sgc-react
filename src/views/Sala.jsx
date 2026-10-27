import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, m } from 'motion/react';
import { Bell, BellOff, Maximize, Mic, MicOff, Monitor, WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { byArrival, byConsulta, turnKey } from '../lib/clinical.js';
import { estimarEsperas, rangoEspera } from '../lib/espera.js';
import { AREAS, TRIAGE_STATION } from '../lib/constants.js';
import { fmtLongDay, fmtT } from '../lib/format.js';
import { beep, announce } from '../lib/sound.js';
import { spring } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { BrandMark } from '../components/BrandMark.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import './sala.css';

/**
 * Turnos para la pantalla. Con sesión se usan los datos en tiempo real del personal; sin sesión
 * (televisor de la sala) se consulta cada 3 s la función pública sgc_sala(), que no entrega datos personales.
 */
function useSalaTurns() {
  const { db, repo } = useStore();
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(false);
  const logged = !!db;
  useEffect(() => {
    if (logged) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const t = await repo.sala();
        if (alive) {
          setFeed(t);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [logged, repo]);
  // La función pública ya entrega los turnos ordenados (sin prioridad ni hora de llegada)
  return { turns: logged ? db.turns : feed || [], error: !logged && error, ordered: !logged };
}

const CONSULTA = 'Consulta';
const CALLED = ['LLAMADO_TRIAJE', 'LLAMADO_CONSULTA'];
// Quien está por pagar no aparece: Admisión le indica la caja y puede pagar en cualquiera que esté libre
const WAITING = ['EN_ESPERA_TRIAJE', 'EN_ESPERA_CONSULTA'];

/**
 * Zona de la sala a la que pertenece un turno: Triaje o el consultorio de su cita.
 * La función pública trae el consultorio de la cita en `zona`; con sesión se toma de la cita.
 */
function zonaDe(t) {
  if (t.state === 'EN_ESPERA_TRIAJE' || t.state === 'LLAMADO_TRIAJE') return TRIAGE_STATION;
  if (t.state === 'LLAMADO_CONSULTA') return t.dest || CONSULTA;
  return t.zona ?? t.cita?.area ?? CONSULTA;
}

/** Cómo se presenta cada zona: color del rol que atiende, ícono y nombre corto. */
function infoZona(name) {
  if (name === TRIAGE_STATION) return { name, kind: 'enf', icon: 'thermometer', title: 'Triaje', sub: name };
  const num = name.match(/(\d+)\s*$/)?.[1];
  // Cada consultorio con su propio color (se repiten de cuatro en cuatro) para que no se confundan en la sala
  const kind = num ? `med c${((num - 1) % 4) + 1}` : 'med';
  return { name, kind, icon: 'stethoscope', title: name, num, sub: name === CONSULTA ? 'Consultorio por confirmar' : 'Consulta médica' };
}

const orden = (z) => (z === TRIAGE_STATION ? 0 : 1);
const sortZonas = (a, b) => orden(a) - orden(b) || a.localeCompare(b, 'es', { numeric: true });

const STORE_KEY = 'sgc.sala.zona';
const readZona = () => {
  try {
    return localStorage.getItem(STORE_KEY) || '';
  } catch {
    return '';
  }
};
const callKey = (t) => `${t.id}@${t.calledAt}`;

/**
 * Pantalla del televisor de la sala de espera. Por privacidad solo muestra códigos de turno y destinos.
 * Cada estación tiene su propia zona con su color, para que con la sala llena nadie confunda a qué
 * ventanilla o consultorio lo llaman. Cada llamado nuevo ocupa toda la pantalla unos segundos y, si se
 * activó, suena un tono y se anuncia por voz. Un televisor puede mostrar solo su estación (se recuerda).
 */
export default function Sala({ standalone = false }) {
  const { turns, error, ordered } = useSalaTurns();
  const sortBy = (list, cmp) => (ordered ? list : [...list].sort(cmp));
  const now = useNow(15_000);
  // El navegador solo permite audio después de una interacción del usuario.
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState(true);
  const [zona, setZona] = useState(readZona);
  // El anuncio lee el sonido vigente sin volver a dispararse cuando se activa o desactiva
  const audio = useRef({ sound, voice });
  useEffect(() => {
    audio.current = { sound, voice };
  }, [sound, voice]);

  // RF-14: la función pública ya trae la espera calculada en la base; con sesión se calcula aquí igual.
  // (Si la base aún no tiene la actualización v1.2, la sala pública no trae marcas de tiempo y no se muestra.)
  const est = estimarEsperas(turns.filter((t) => t.t0 != null), now);
  const espera = (t) => rangoEspera(t.espera ?? est.get(turnKey(t)), { aprox: true });

  const calls = turns.filter((t) => CALLED.includes(t.state)).sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0));
  const waiting = turns.filter((t) => WAITING.includes(t.state));
  const names = [...new Set([TRIAGE_STATION, ...AREAS, ...calls.map(zonaDe), ...waiting.map(zonaDe)])].sort(sortZonas);
  const zonas = names.map((name) => {
    const cola = waiting.filter((t) => zonaDe(t) === name);
    const cmp = name === TRIAGE_STATION ? byArrival : byConsulta;
    return { ...infoZona(name), calls: calls.filter((t) => zonaDe(t) === name), waiting: sortBy(cola, cmp) };
  });
  // Una zona elegida que ya no existe (se renombró un consultorio) vuelve a mostrar todas
  const single = zonas.find((z) => z.name === zona);
  const shown = single ? [single] : zonas.filter((z) => z.name !== CONSULTA || z.calls.length || z.waiting.length);

  const elegir = (z) => {
    setZona(z);
    try {
      localStorage.setItem(STORE_KEY, z);
    } catch {
      /* sin almacenamiento: solo dura esta sesión */
    }
  };

  // Llamados nuevos: se muestran uno tras otro a pantalla completa (los de la primera carga no se anuncian)
  const seen = useRef(null);
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(calls.map(callKey));
      return;
    }
    const fresh = calls.filter((t) => !seen.current.has(callKey(t))).reverse();
    if (!fresh.length) return;
    fresh.forEach((t) => seen.current.add(callKey(t)));
    const mine = fresh.filter((t) => !single || zonaDe(t) === single.name);
    if (mine.length) setQueue((q) => [...q, ...mine].slice(-4));
  }, [calls, single]);

  const flash = queue[0];
  const flashKey = flash ? callKey(flash) : '';
  useEffect(() => {
    if (!flash) return undefined;
    if (audio.current.sound) {
      beep();
      if (audio.current.voice) setTimeout(() => announce(flash.id, flash.dest), 700);
    }
    const id = setTimeout(() => setQueue((q) => q.slice(1)), 7000);
    return () => clearTimeout(id);
  }, [flash]);

  const last = calls[0];
  const limit = single ? 24 : shown.length > 4 ? 5 : 7;

  return (
    <div className={`sala ${standalone ? 'full' : ''} ${single ? 'one' : ''}`}>
      <header className="sala-h">
        <BrandMark />
        <div><b>Centro de Salud</b><span>{single ? `Sala de espera · ${single.title}` : 'Sala de espera'}</span></div>
        <div className="clock"><b>{fmtT(now)}</b><span>{fmtLongDay(now)}</span></div>
      </header>

      {/* Con una sola estación su propio recuadro «Llamando» ya muestra el llamado */}
      {!single && <div className="sala-last" aria-live="assertive">
        {last ? (
          <AnimatePresence mode="popLayout" initial={false}>
            <m.div
              key={callKey(last)}
              className={`last z-${infoZona(zonaDe(last)).kind}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <small>Último llamado</small>
              <b className="last-code">{last.id}</b>
              <span className="last-arrow" aria-hidden="true">→</span>
              <span className="sr-only">pase a</span>
              <b className="last-dest">{last.dest}</b>
            </m.div>
          </AnimatePresence>
        ) : (
          <div className="last none">Sin llamados en este momento. Permanezca atento a su código.</div>
        )}
      </div>}

      <div className={`sala-zonas n${shown.length}`}>
        {shown.map((z) => <Zona key={z.name} z={z} espera={espera} limit={limit} single={!!single} />)}
      </div>

      <footer className="sala-f">
        <span className={error ? 'err' : ''}>
          {error
            ? <><WifiOff aria-hidden="true" /> Sin conexión: reintentando…</>
            : 'Busque el color de su estación. La espera es aproximada: los casos más graves pasan primero.'}
        </span>
        <div className="sala-ctl">
          <label className="sala-sel">
            <Monitor aria-hidden="true" />
            <span className="sr-only">Esta pantalla muestra</span>
            <select value={single ? zona : ''} onChange={(e) => elegir(e.target.value)}>
              <option value="">Todas las estaciones</option>
              {zonas.filter((z) => z.name !== CONSULTA).map((z) => <option key={z.name} value={z.name}>Solo {z.title}</option>)}
            </select>
          </label>
          <button onClick={() => { setSound((s) => !s); if (!sound) beep(); }} aria-pressed={sound}>
            {sound ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}{sound ? 'Sonido activado' : 'Activar sonido'}
          </button>
          {sound && (
            <button onClick={() => setVoice((v) => !v)} aria-pressed={voice}>
              {voice ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}{voice ? 'Voz: sí' : 'Voz: no'}
            </button>
          )}
          {standalone && (
            <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}><Maximize aria-hidden="true" /> Pantalla completa</button>
          )}
        </div>
      </footer>

      <AnimatePresence>
        {flash && (
          <m.div
            key={flashKey}
            className={`sala-flash z-${infoZona(zonaDe(flash)).kind}`}
            role="alert"
            onClick={() => setQueue((q) => q.slice(1))}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 22 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <Icon3D name={infoZona(zonaDe(flash)).icon} size={96} />
            <small>Turno</small>
            <b className="flash-code">{flash.id}</b>
            <span className="flash-to"><small>Pase a</small><b>{flash.dest}</b></span>
            {queue.length > 1 && <span className="flash-more">{queue.length - 1} llamado{queue.length > 2 ? 's' : ''} más</span>}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Una estación: quién está llamado ahora y quiénes siguen, en el color de la estación. */
function Zona({ z, espera, limit, single }) {
  const rest = z.waiting.length - limit;
  return (
    <section className={`zona z-${z.kind}`} aria-label={z.title}>
      <header className="zona-h">
        {z.num ? <span className="zona-num" aria-hidden="true">{z.num}</span> : <Icon3D name={z.icon} size={44} />}
        <div><h2>{z.title}</h2><span>{z.sub}</span></div>
      </header>

      <div className="zona-now" aria-live={single ? 'assertive' : undefined}>
        <small>Llamando</small>
        <AnimatePresence mode="popLayout" initial={false}>
          {z.calls.length ? (
            <m.div key={z.calls.map(callKey).join()} className="zona-called" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: spring }} exit={{ opacity: 0 }}>
              {z.calls.slice(0, 2).map((t) => <b key={t.id}>{t.id}</b>)}
            </m.div>
          ) : (
            <m.span key="none" className="zona-free" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>—</m.span>
          )}
        </AnimatePresence>
      </div>

      <h3>Siguen<span className="zona-count"><b>{z.waiting.length}</b> en espera</span></h3>
      <LayoutGroup id={`zona-${z.name}`}>
        <ol className="zona-list">
          <AnimatePresence initial={false}>
            {z.waiting.slice(0, limit).map((t, i) => (
              <m.li key={t.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={spring}>
                <i aria-hidden="true">{i + 1}</i>
                <span>{t.id}</span>
                {espera(t) && <small><span className="sr-only">Espera aproximada: </span>{espera(t)}</small>}
              </m.li>
            ))}
          </AnimatePresence>
        </ol>
      </LayoutGroup>
      {!z.waiting.length && <p className="none-sm">Sin turnos en espera</p>}
      {rest > 0 && <p className="none-sm">y {rest} más</p>}
    </section>
  );
}
