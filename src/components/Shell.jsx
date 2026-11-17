import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import {
  CirclePlay, PanelLeftClose, PanelLeftOpen, ExternalLink, KeyRound, LogOut, Menu, Moon, PhoneCall, RotateCcw, Search, Sun, Tv, LayoutGrid,
} from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { ACTIVE_STATES, QUEUE, ROLES } from '../lib/constants.js';
import { fmtT } from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';
import { byTriaje, byConsulta } from '../lib/clinical.js';
import { callNext } from '../store/actions.js';
import { fade, soft } from '../lib/motion.js';
import { go } from '../hooks/useHash.js';
import { useTheme } from '../hooks/useTheme.js';
import { useHotkey } from '../hooks/useHotkey.js';
import { useActivity } from '../hooks/useActivity.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { AnimatedNumber, Avatar, Kbd, Msg } from './ui.jsx';
import { Icono } from './Icono.jsx';
import { BrandMark } from './BrandMark.jsx';
import { BotonAnimaciones } from './BotonAnimaciones.jsx';
import { ChangePassword } from './ChangePassword.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { Notifications } from './Notifications.jsx';
import { Supervision } from './Supervision.jsx';

// El simulador (y los datos de prueba que usa) se descargan recién al abrirlo
const Simulador = lazy(() => import('./Simulador.jsx'));

const SALA = ['sala', 'Pantalla de sala', 'tv'];
/** Qué se hace en cada sección: la segunda línea de cada entrada del menú. */
const SECCION_SUB = {
  registro: 'Registro y entrega de turnos', citas: 'Pacientes que aún no tienen cita', agenda: 'Citas de hoy y próximos días',
  flujo: 'Dónde está cada paciente', cobros: 'Pagos y boletas', lista: 'Signos vitales y prioridad',
  atencion: 'Consulta, diagnóstico y receta', historias: 'Buscar y revisar atenciones', tablero: 'Indicadores del centro',
  usuarios: 'Cuentas del personal', horarios: 'Días de atención y cupos', auditoria: 'Quién hizo qué y cuándo',
  umbrales: 'Reglas de la prioridad', sala: 'Lo que ve el paciente',
};
/** El menú se puede plegar a solo íconos; la elección se recuerda en este equipo. */
/** Hora corta del menú (24 h), para que entre junto al nombre del espacio. */
const HORA = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
const MENU_KEY = 'sgc.menu';
const leerMenu = () => {
  try {
    return localStorage.getItem(MENU_KEY) === 'mini';
  } catch {
    return false;
  }
};
/** Texto del indicador de conexión y de la sesión según dónde se guardan los datos. */
const CONEXION = { supabase: 'En línea', local: 'Local', sim: 'Simulación' };
const SESION = {
  supabase: 'Sesión segura: se cierra tras 15 minutos sin actividad.',
  local: 'Modo local de desarrollo.',
  sim: 'Simulación: datos de prueba, no se guarda nada en la base real.',
};
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Pacientes que esperan en la etapa de cada rol (contador del menú y del título de la pestaña).
 * El médico solo cuenta a los pacientes que tienen cita con él.
 */
const waitingFor = (user, turns) =>
  QUEUE[user.role] ? turns.filter((t) => QUEUE[user.role].includes(t.state) && (user.role !== 'med' || !t.cita || t.cita.med === user.u)).length : 0;

/** Trazo de ECG del menú: cuatro latidos (línea base, onda P, complejo QRS y onda T). */
const LATIDO = 'l14 0 q3 -4 6 0 l4 0 l2 3 l3 -15 l3 19 l2 -7 l5 0 q4 -6 8 0 l13 0';
const ECG = `M0 20 ${LATIDO} ${LATIDO} ${LATIDO} ${LATIDO}`;

/**
 * «Censo del centro»: el espacio del rol y las dos cifras que todos necesitan ver en cualquier pantalla
 * (pacientes en el centro y críticos), con un trazo de ECG que late más rápido y en rojo si hay un paciente crítico.
 */
function Censo({ role, turns }) {
  const now = useNow(30_000);
  const enCentro = turns.filter((t) => ACTIVE_STATES.includes(t.state) && t.state !== 'CITADO');
  const criticos = enCentro.filter((t) => t.prio === 'CRITICA').length;
  return (
    <div className="censo">
      <div className="censo-h">
        <Icono name={role.icon} size={36} />
        <div><small>Su espacio</small><b>{role.n}</b></div>
        <time className="censo-hora" title={fmtT(now)}>{HORA.format(now)}</time>
      </div>
      <svg className={`censo-ecg ${criticos ? 'crit' : ''}`} viewBox="0 0 240 30" preserveAspectRatio="none" aria-hidden="true">
        <path className="base" d={ECG} />
        <path className="trazo" d={ECG} pathLength="1000" />
      </svg>
      <dl aria-label="Censo del centro">
        <div><dt>En el centro</dt><dd><AnimatedNumber value={enCentro.length} /></dd></div>
        <div className={criticos ? 'crit' : ''}><dt>Críticos</dt><dd><AnimatedNumber value={criticos} /></dd></div>
      </dl>
    </div>
  );
}

/** Marco del espacio de trabajo de cada rol: identidad, navegación, búsqueda, avisos y sesión. */
export function Shell({ section, children }) {
  const { db, user, repo, status, signOut, resetDemo, idleLeft, run, area, toast } = useStore();
  const [ask, dialog] = useConfirm();
  const [pwd, setPwd] = useState(false);
  const [palette, setPalette] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [sim, setSim] = useState(false);
  const [mini, setMini] = useState(leerMenu);
  const plegar = () => setMini((x) => {
    try {
      localStorage.setItem(MENU_KEY, x ? 'ancho' : 'mini');
    } catch {
      /* sin almacenamiento: dura hasta recargar */
    }
    return !x;
  });
  const { effective, toggle } = useTheme();
  const onCritical = useCallback((text) => toast('crit', text), [toast]);
  const feed = useActivity(db, user, onCritical);
  const role = ROLES[user.role];
  const base = `/${role.slug}`;
  const sections = role.sections;
  const current = section === 'sala' ? SALA : sections.find(([k]) => k === section) || sections[0];
  const waiting = waitingFor(user, db.turns);
  const queueSection = role.queue || sections[0][0];

  useHotkey((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k', () => setPalette(true));
  useEffect(() => {
    document.title = `${waiting ? `(${waiting}) ` : ''}${current[1]} · SGC`;
  }, [waiting, current]);

  const confirmReset = useCallback(
    () =>
      ask({
        title: 'Restablecer datos de demostración',
        text: `Se borrarán los turnos, pacientes, atenciones y la auditoría${repo.kind === 'supabase' ? ' en Supabase para todos los equipos conectados' : ''}, y se cargarán varias semanas de atenciones de ejemplo. Las cuentas de usuario se conservan.`,
        confirmLabel: 'Restablecer',
        danger: true,
        onConfirm: resetDemo,
      }),
    [ask, repo.kind, resetDemo],
  );

  const commands = useMemo(() => {
    const nav = [...sections, SALA].map(([k, l]) => ({ id: `go-${k}`, group: 'Ir a', label: l, icon: k === 'sala' ? Tv : LayoutGrid, run: () => go(`${base}/${k}`) }));
    const acts = [];
    if (user.role === 'enf') acts.push({ id: 'next-tri', group: 'Acciones', label: 'Llamar al siguiente paciente de triaje', icon: PhoneCall, run: () => run(callNext, 'tri', byTriaje) });
    if (user.role === 'med') acts.push({ id: 'next-med', group: 'Acciones', label: `Llamar al siguiente paciente a ${area}`, icon: PhoneCall, run: () => run(callNext, 'med', byConsulta) });
    acts.push(
      { id: 'sala-ext', group: 'Acciones', label: 'Abrir la pantalla de sala en otra ventana', icon: ExternalLink, run: () => window.open('#/sala', '_blank', 'noopener') },
      { id: 'sim', group: 'Acciones', label: 'Simular el ciclo del paciente', icon: CirclePlay, keywords: 'simulación prueba demo escenario', run: () => setSim(true) },
      { id: 'theme', group: 'Preferencias', label: effective === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro', icon: effective === 'dark' ? Sun : Moon, keywords: 'tema modo oscuro claro', run: toggle },
      { id: 'pwd', group: 'Cuenta', label: 'Cambiar mi contraseña', icon: KeyRound, run: () => setPwd(true) },
    );
    if (user.role === 'jef') acts.push({ id: 'reset', group: 'Cuenta', label: 'Restablecer datos de demostración', icon: RotateCcw, run: confirmReset });
    acts.push({ id: 'out', group: 'Cuenta', label: 'Cerrar sesión', icon: LogOut, run: () => signOut() });
    return [...nav, ...acts];
  }, [sections, base, user.role, area, effective, run, toggle, signOut, confirmReset]);

  const navItem = ([k, l, icon], count) => (
    <a key={k} className="nb" href={`#${base}/${k}`} title={mini ? l : undefined} aria-current={current[0] === k ? 'page' : undefined} onClick={() => setNavOpen(false)}>
      {current[0] === k && <m.i className="nb-on" layoutId="nb-on" transition={soft} aria-hidden="true" />}
      <span className="nb-ico"><Icono name={icon} size={18} /></span>
      <span className="lbl"><b>{l}</b><small>{SECCION_SUB[k]}</small></span>
      {count > 0 && <span key={count} className="cnt" title="Pacientes en espera en su etapa">{count}</span>}
    </a>
  );

  return (
    <div className="app" data-role={user.role} data-nav={navOpen ? 'open' : undefined} data-menu={mini ? 'mini' : undefined}>
      <aside className="side" aria-label="Menú del espacio de trabajo">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Gestión clínica · Centro de Salud</span></div>
          <button type="button" className="plegar" onClick={plegar} aria-pressed={mini} aria-label={mini ? 'Mostrar el menú completo' : 'Plegar el menú a solo íconos'} title={mini ? 'Mostrar el menú completo' : 'Plegar el menú'}>
            {mini ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>
        <Censo role={role} turns={db.turns} />
        <nav className="line-nav" aria-label="Secciones">
          <span className="rotulo" aria-hidden="true">Secciones</span>
          {sections.map((s) => navItem(s, s[0] === queueSection ? waiting : 0))}
          <span className="ln-sep" aria-hidden="true" />
          {navItem(SALA)}
          <a className="nb ext" href="#/sala" target="_blank" rel="noreferrer" title={mini ? 'Abrir la sala en otra ventana' : undefined}>
            <span className="nb-ico"><ExternalLink aria-hidden="true" /></span>
            <span className="lbl"><b>Abrir la sala en otra ventana</b></span>
          </a>
        </nav>
        <button type="button" className="atajo" onClick={() => setPalette(true)} title="Buscar o ir a cualquier sección">
          <Search aria-hidden="true" />
          <span>Buscar o ir a…</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>
        <div className="me">
          <div className="me-card">
            <span className="me-av"><Avatar name={user.n} /><i className={status.ok ? 'on' : ''} title={status.ok ? 'Conectado' : 'Sin conexión'} /></span>
            <div><b>{user.n}</b><span>{user.u}{user.col ? ` (${user.col})` : ''}</span></div>
          </div>
          <button className="lnk" onClick={() => setPwd(true)} title="Cambiar contraseña"><KeyRound /> <span>Cambiar contraseña</span></button>
          {user.role === 'jef' && <button className="lnk" onClick={confirmReset} title="Restablecer datos demo"><RotateCcw /> <span>Restablecer datos demo</span></button>}
          <button className="lnk" onClick={() => signOut()} title="Cerrar sesión"><LogOut /> <span>Cerrar sesión</span></button>
          <small className="sess">{SESION[repo.kind] ?? SESION.local}</small>
        </div>
      </aside>
      <AnimatePresence>{navOpen && <m.div {...fade} className="scrim" onClick={() => setNavOpen(false)} />}</AnimatePresence>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Abrir menú" onClick={() => setNavOpen(true)}><Menu /></button>
          <div className="crumbs">
            <span>{role.n}</span>
            <i aria-hidden="true">/</i>
            <b>{current[1]}</b>
          </div>
          <button className="top-search" onClick={() => setPalette(true)} aria-label="Buscar o ir a (Ctrl + K)">
            <Search aria-hidden="true" />
            <span className="txt">Buscar o ir a…</span>
            <span className="keys" aria-hidden="true"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
          </button>
          {repo.kind !== 'sim' && (
            <button className="btn sec sm sim-btn" onClick={() => setSim(true)} title="Simular paso a paso el ciclo de un paciente (no cambia datos reales)">
              <CirclePlay aria-hidden="true" /> <span className="txt">Simulación</span>
            </button>
          )}
          <Notifications feed={feed} />
          <BotonAnimaciones conTexto={false} />
          <button className="icon-btn" onClick={toggle} aria-label={effective === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>
            {effective === 'dark' ? <Sun /> : <Moon />}
          </button>
          <span className={`conn ${status.ok ? '' : 'bad'}`} title={status.msg || repo.label}>
            <i className="dot" aria-hidden="true" />
            <span className="txt">{status.ok ? (CONEXION[repo.kind] ?? CONEXION.local) : 'Sin conexión'}</span>
          </span>
        </header>
        {!status.ok && (
          <div className="idle">
            <Msg tone="crit" role="alert">
              <b>Sin conexión con el servidor.</b> {status.msg} Los cambios no se guardan hasta que vuelva la conexión; la pantalla se actualizará sola.
            </Msg>
          </div>
        )}
        {idleLeft != null && (
          <div className="idle">
            <Msg tone="warn" role="alert">
              Su sesión se cerrará en <b>{Math.ceil(idleLeft / 1000)} s</b> por inactividad. Mueva el mouse o pulse una tecla para continuar.
            </Msg>
          </div>
        )}
        {user.role !== 'caj' && <Supervision turns={db.turns} user={user} onNueva={onCritical} />}
        <main className="page" id="contenido">{children}</main>
      </div>

      <AnimatePresence>{palette && <CommandPalette key="palette" commands={commands} onClose={() => setPalette(false)} />}</AnimatePresence>
      <AnimatePresence>{pwd && <ChangePassword key="pwd" onClose={() => setPwd(false)} />}</AnimatePresence>
      {sim && <Suspense fallback={null}><Simulador onClose={() => setSim(false)} /></Suspense>}
      {dialog}
    </div>
  );
}
