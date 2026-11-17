import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Bell, BellOff, Maximize, Mic, MicOff, Monitor, WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { byTriaje, byConsulta, turnKey } from '../lib/clinical.js';
import { estimarEsperas, rangoEspera } from '../lib/espera.js';
import { AREAS, TRIAGE_STATION, modulosTriaje } from '../lib/constants.js';
import { fmtLongDay, fmtT } from '../lib/format.js';
import { beep, announce } from '../lib/sound.js';
import { cambio, fila, llamado, pantalla } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { BrandMark } from '../components/BrandMark.jsx';
import '../styles/vistas/sala.css';

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

/** Estaciones por página del tablero y segundos que se muestra cada página cuando hay más de una. */
const POR_PAGINA = 6;
const SEG_PAGINA = 8;
/** Turnos que se muestran en «Siguen» por estación (el resto se resume en el contador). */
const SIGUEN = 4;

/**
 * Zona de la sala a la que pertenece un turno: Triaje o el consultorio de su cita.
 * La función pública trae el consultorio de la cita en `zona`; con sesión se toma de la cita.
 */
function zonaDe(t) {
  if (t.state === 'EN_ESPERA_TRIAJE' || t.state === 'LLAMADO_TRIAJE') return TRIAGE_STATION;
  if (t.state === 'LLAMADO_CONSULTA') return t.dest || CONSULTA;
  return t.zona ?? t.cita?.area ?? CONSULTA;
}

/** Cómo se presenta cada zona: su color, la sigla de su ficha y su nombre. */
function infoZona(name) {
  if (name === TRIAGE_STATION) return { name, kind: 'enf', sigla: 'T', title: 'Triaje', sub: name };
  const num = name.match(/(\d+)\s*$/)?.[1];
  // Cada consultorio con su propio color (ocho tonos) para que no se confundan en la sala
  const kind = num ? `med c${((num - 1) % 8) + 1}` : 'med';
  return { name, kind, sigla: num ?? 'C', title: name, sub: name === CONSULTA ? 'Consultorio por confirmar' : 'Consulta' };
}

/** Las estaciones libres en una línea corta: «Triaje · Consultorios 2, 3 y 5» (no repite la palabra en cada una). */
function resumenLibres(libres) {
  const nums = libres.filter((z) => z.kind !== 'enf' && /^\d+$/.test(z.sigla)).map((z) => z.sigla);
  const otras = libres.filter((z) => z.kind === 'enf' || !/^\d+$/.test(z.sigla)).map((z) => z.title);
  const lista = nums.length > 1 ? `${nums.slice(0, -1).join(', ')} y ${nums.at(-1)}` : nums[0];
  return [...otras, nums.length ? `Consultorio${nums.length > 1 ? 's' : ''} ${lista}` : null].filter(Boolean).join(' · ');
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
 *
 * Distribución: a la izquierda, el llamado vigente bien grande y los anteriores; a la derecha, un tablero con
 * un renglón por estación (a quién llama y quiénes siguen). El tablero está pensado para crecer: solo lista
 * las estaciones con pacientes, resume las libres en una línea y, si no entran todas, pasa de página solo.
 * Cada llamado nuevo ocupa toda la pantalla unos segundos y, si se activó, suena un tono y se anuncia por voz.
 * Un televisor puede mostrar solo su estación (se recuerda).
 */
export default function Sala({ standalone = false }) {
  const { turns, error, ordered } = useSalaTurns();
  const { db } = useStore();
  const sortBy = (list, cmp) => (ordered ? list : [...list].sort(cmp));
  const now = useNow(15_000);
  // El navegador solo permite audio después de una interacción del usuario.
  const [sound, setSound] = useState(false);
  const [voice, setVoice] = useState(true);
  const [zona, setZona] = useState(readZona);
  const [pag, setPag] = useState(0);
  // El anuncio lee el sonido vigente sin volver a dispararse cuando se activa o desactiva
  const audio = useRef({ sound, voice });
  useEffect(() => {
    audio.current = { sound, voice };
  }, [sound, voice]);

  // RF-14: la función pública ya trae la espera calculada en la base; con sesión se calcula aquí igual.
  // (Si la base aún no tiene la actualización v1.2, la sala pública no trae marcas de tiempo y no se muestra.)
  const est = estimarEsperas(turns.filter((t) => t.t0 != null), now, { modulos: modulosTriaje(db?.users) });
  const espera = (t) => rangoEspera(t.espera ?? est.get(turnKey(t)), { aprox: true });

  const calls = turns.filter((t) => CALLED.includes(t.state)).sort((a, b) => (b.calledAt || 0) - (a.calledAt || 0));
  const waiting = turns.filter((t) => WAITING.includes(t.state));
  const names = [...new Set([TRIAGE_STATION, ...AREAS, ...calls.map(zonaDe), ...waiting.map(zonaDe)])].sort(sortZonas);
  const zonas = names.map((name) => {
    const cola = waiting.filter((t) => zonaDe(t) === name);
    const cmp = name === TRIAGE_STATION ? byTriaje : byConsulta;
    return { ...infoZona(name), calls: calls.filter((t) => zonaDe(t) === name), waiting: sortBy(cola, cmp) };
  });
  // Una zona elegida que ya no existe (se renombró un consultorio) vuelve a mostrar todas
  const single = zonas.find((z) => z.name === zona);

  // Tablero: solo las estaciones con pacientes; las libres se resumen en una línea
  const activas = zonas.filter((z) => z.calls.length || z.waiting.length);
  const libres = zonas.filter((z) => z.name !== CONSULTA && !z.calls.length && !z.waiting.length);
  const paginas = Math.max(1, Math.ceil(activas.length / POR_PAGINA));
  const actual = pag % paginas;
  const visibles = activas.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA);
  useEffect(() => {
    if (paginas < 2) return undefined;
    const id = setInterval(() => setPag((p) => p + 1), SEG_PAGINA * 1000);
    return () => clearInterval(id);
  }, [paginas]);

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

  // Con una sola estación, el llamado vigente y los anteriores son solo los suyos
  const mios = single ? single.calls : calls;
  const last = mios[0];

  return (
    <div className={`sala ${standalone ? 'full' : ''} ${single ? 'one' : ''}`}>
      <header className="sala-h">
        <BrandMark />
        <div><b>Centro de Salud</b><span>{single ? `Sala de espera · ${single.title}` : 'Sala de espera'}</span></div>
        <div className="clock"><b>{fmtT(now)}</b><span>{fmtLongDay(now)}</span></div>
      </header>

      <div className="sala-cuerpo">
        <section className="sala-ahora" aria-live="assertive" aria-label="Llamando ahora">
          <AnimatePresence mode="popLayout" initial={false}>
            {last ? (
              <m.div key={callKey(last)} className={`ahora-caja z-${infoZona(zonaDe(last)).kind}`} {...llamado}>
                <span className="ahora-rot">Llamando ahora</span>
                <Tablillas className="ahora-cod" texto={last.id} />
                <span className="ahora-dest"><small>Pase a</small>{last.dest}</span>
              </m.div>
            ) : (
              <m.div key="none" className="ahora-caja none" {...llamado}>
                <span className="ahora-rot">Llamando ahora</span>
                <p>Sin llamados en este momento.</p>
                <p>Permanezca atento a su código.</p>
              </m.div>
            )}
          </AnimatePresence>
          {mios.length > 1 && (
            <>
              <h2 className="sala-rot">Llamados anteriores</h2>
              <ol className="sala-prev">
                <AnimatePresence initial={false}>
                  {mios.slice(1, 5).map((t) => (
                    <m.li key={callKey(t)} layout {...fila} className={`z-${infoZona(zonaDe(t)).kind}`}>
                      <b>{t.id}</b>
                      <span>{t.dest}</span>
                    </m.li>
                  ))}
                </AnimatePresence>
              </ol>
            </>
          )}
        </section>

        {single ? (
          <ColaUnica z={single} espera={espera} />
        ) : (
          <section className="sala-tabla" aria-label="Estaciones">
            <div className="tabla-h" aria-hidden="true">
              <span>Estación</span><span>Llamando</span><span>Siguen</span><span>En espera</span>
            </div>
            <div className="tabla-filas">
              {visibles.length ? (
                <AnimatePresence mode="popLayout" initial={false}>
                  {visibles.map((z) => <FilaZona key={z.name} z={z} espera={espera} />)}
                </AnimatePresence>
              ) : (
                <p className="tabla-vacia">No hay pacientes en espera.</p>
              )}
            </div>
            <footer className="tabla-pie">
              {libres.length > 0 && (
                <span className="tabla-libres"><b>Sin espera:</b> {resumenLibres(libres)}</span>
              )}
              {paginas > 1 && (
                <span className="tabla-pags" aria-label={`Página ${actual + 1} de ${paginas}`}>
                  {Array.from({ length: paginas }, (_, i) => <i key={i} className={i === actual ? 'on' : ''} />)}
                  <span>{actual + 1} / {paginas}</span>
                </span>
              )}
            </footer>
          </section>
        )}
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
            {...pantalla}
          >
            <small>Turno</small>
            <Tablillas className="flash-code" texto={flash.id} />
            <span className="flash-to"><small>Pase a</small><b>{flash.dest}</b></span>
            {queue.length > 1 && <span className="flash-more">{queue.length - 1} llamado{queue.length > 2 ? 's' : ''} más</span>}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Código que se arma letra por letra, como las tablillas de un tablero de salidas (motion.css: «tablilla»). */
const Tablillas = ({ texto, className }) => (
  <b className={`tablillas ${className}`} aria-label={texto}>
    {[...texto].map((c, i) => <span key={i} aria-hidden="true" style={{ '--i': i }}>{c}</span>)}
  </b>
);

/** Ficha de color de una estación: la «T» de triaje o el número del consultorio. */
const Ficha = ({ z }) => <span className="fz-ficha" aria-hidden="true">{z.sigla}</span>;

/** Un renglón del tablero: la estación, a quién llama, quiénes siguen y cuántos esperan. */
function FilaZona({ z, espera }) {
  const resto = z.waiting.length - SIGUEN;
  return (
    <m.div layout {...fila} className={`fila-z z-${z.kind}`} role="group" aria-label={z.title}>
      <div className="fz-est">
        <Ficha z={z} />
        <span><b>{z.title}</b><small>{z.sub}</small></span>
      </div>
      <div className="fz-llama">
        <AnimatePresence mode="popLayout" initial={false}>
          {z.calls.length ? (
            <m.b key={z.calls.map(callKey).join()} {...cambio}>{z.calls[0].id}</m.b>
          ) : (
            <m.span key="none" {...cambio}>—</m.span>
          )}
        </AnimatePresence>
      </div>
      <ol className="fz-sig">
        <AnimatePresence initial={false}>
          {z.waiting.slice(0, SIGUEN).map((t) => (
            <m.li key={t.id} layout {...fila}>
              <b>{t.id}</b>
              {espera(t) && <small><span className="sr-only">Espera aproximada: </span>{espera(t)}</small>}
            </m.li>
          ))}
        </AnimatePresence>
        {resto > 0 && <li className="mas">+{resto}</li>}
      </ol>
      <div className="fz-n"><b>{z.waiting.length}</b><small>en espera</small></div>
    </m.div>
  );
}

/** Televisor de una sola estación: su fila completa, en varias columnas. */
function ColaUnica({ z, espera }) {
  const LIMITE = 24;
  const resto = z.waiting.length - LIMITE;
  return (
    <section className={`sala-tabla sala-cola z-${z.kind}`} aria-label={`Siguen en ${z.title}`}>
      <div className="tabla-h">
        <span className="fz-est"><Ficha z={z} /> {z.title}</span>
        <span className="fz-n"><b>{z.waiting.length}</b><small>en espera</small></span>
      </div>
      {z.waiting.length ? (
        <ol className="cola-lista">
          <AnimatePresence initial={false}>
            {z.waiting.slice(0, LIMITE).map((t, i) => (
              <m.li key={t.id} layout {...fila}>
                <i aria-hidden="true">{i + 1}</i>
                <b>{t.id}</b>
                {espera(t) && <small><span className="sr-only">Espera aproximada: </span>{espera(t)}</small>}
              </m.li>
            ))}
          </AnimatePresence>
        </ol>
      ) : <p className="tabla-vacia">Sin turnos en espera.</p>}
      {resto > 0 && <footer className="tabla-pie"><span>y {resto} más</span></footer>}
    </section>
  );
}
