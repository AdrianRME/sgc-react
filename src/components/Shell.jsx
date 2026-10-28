import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import {
  ChevronRight, CirclePlay, ExternalLink, KeyRound, LogOut, Menu, Moon, PhoneCall, RotateCcw, Search, Sun, Tv, LayoutGrid,
} from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { ACTIVE_STATES, QUEUE, ROLES } from '../lib/constants.js';
import { byArrival, byConsulta } from '../lib/clinical.js';
import { callNext } from '../store/actions.js';
import { fade } from '../lib/motion.js';
import { go } from '../hooks/useHash.js';
import { useTheme } from '../hooks/useTheme.js';
import { useHotkey } from '../hooks/useHotkey.js';
import { useActivity } from '../hooks/useActivity.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { Avatar, Kbd, Msg } from './ui.jsx';
import { Icon3D } from './Icon3D.jsx';
import { BrandMark } from './BrandMark.jsx';
import { ChangePassword } from './ChangePassword.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { Notifications } from './Notifications.jsx';

// El simulador (y los datos de prueba que usa) se descargan recién al abrirlo
const Simulador = lazy(() => import('./Simulador.jsx'));

const SALA = ['sala', 'Pantalla de sala', 'tv'];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Pacientes que esperan en la etapa de cada rol (contador del menú y del título de la pestaña).
 * El médico solo cuenta a los pacientes que tienen cita con él.
 */
const waitingFor = (user, turns) =>
  QUEUE[user.role] ? turns.filter((t) => QUEUE[user.role].includes(t.state) && (user.role !== 'med' || !t.cita || t.cita.med === user.u)).length : 0;

/** Un latido del trazo de ECG (60 de ancho): línea base, onda P, complejo QRS y onda T. */
const LATIDO = 'l14 0 q3 -4 6 0 l4 0 l2 3 l3 -16 l3 20 l2 -7 l5 0 q4 -6 8 0 l13 0';

/**
 * «Pulso del centro»: el espacio del rol como la pantalla de un monitor, con un trazo de ECG y las cifras vivas
 * del centro (pacientes en el centro y críticos). Es la misma identidad del inicio de sesión.
 */
function Pulso({ role, turns }) {
  const enCentro = turns.filter((t) => ACTIVE_STATES.includes(t.state) && t.state !== 'CITADO');
  const criticos = enCentro.filter((t) => t.prio === 'CRITICA').length;
  return (
    <div className="pulso">
      <div className="pulso-h">
        <Icon3D name={role.icon} size={38} />
        <div><small>Su espacio</small><b>{role.n}</b></div>
      </div>
      <svg className={`pulso-ecg ${criticos ? 'crit' : ''}`} viewBox="0 0 240 34" preserveAspectRatio="none" aria-hidden="true">
        <path className="base" d={`M0 22 ${LATIDO} ${LATIDO} ${LATIDO} ${LATIDO}`} />
        <path className="trazo" d={`M0 22 ${LATIDO} ${LATIDO} ${LATIDO} ${LATIDO}`} pathLength="1000" />
      </svg>
      <dl className="pulso-st" aria-label="Pulso del centro">
        <div><dt>Pacientes</dt><dd>{enCentro.length}</dd></div>
        <div className={criticos ? 'crit' : ''}><dt>Críticos</dt><dd>{criticos}</dd></div>
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
    if (user.role === 'enf') acts.push({ id: 'next-tri', group: 'Acciones', label: 'Llamar al siguiente paciente de triaje', icon: PhoneCall, run: () => run(callNext, 'tri', byArrival) });
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
    <a key={k} className="nb" href={`#${base}/${k}`} aria-current={current[0] === k ? 'page' : undefined} onClick={() => setNavOpen(false)}>
      <i className="stop" aria-hidden="true" />
      <Icon3D name={icon} size={22} />
      <span className="lbl">{l}</span>
      {count > 0 && <span className="cnt" title="Pacientes en espera en su etapa">{count}</span>}
    </a>
  );

  return (
    <div className="app" data-role={user.role} data-nav={navOpen ? 'open' : undefined}>
      <aside className="side" aria-label="Menú del espacio de trabajo">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Gestión clínica · Centro de Salud</span></div>
        </div>
        <Pulso role={role} turns={db.turns} />
        <nav className="line-nav" aria-label="Secciones">
          {sections.map((s) => navItem(s, s[0] === queueSection ? waiting : 0))}
          <span className="ln-sep" aria-hidden="true" />
          {navItem(SALA)}
          <a className="nb ext" href="#/sala" target="_blank" rel="noreferrer">
            <i className="stop" aria-hidden="true" />
            <span className="lbl">Sala en otra ventana</span>
            <ExternalLink aria-hidden="true" />
          </a>
        </nav>
        <div className="me">
          <div className="me-card">
            <Avatar name={user.n} />
            <div><b>{user.n}</b><span>{user.u}{user.col ? ` (${user.col})` : ''}</span></div>
          </div>
          <button className="lnk" onClick={() => setPwd(true)}><KeyRound /> Cambiar contraseña</button>
          {user.role === 'jef' && <button className="lnk" onClick={confirmReset}><RotateCcw /> Restablecer datos demo</button>}
          <button className="lnk" onClick={() => signOut()}><LogOut /> Cerrar sesión</button>
          <small className="sess">{repo.kind === 'supabase' ? 'Sesión segura: se cierra tras 15 minutos sin actividad.' : 'Modo local de desarrollo.'}</small>
        </div>
      </aside>
      <AnimatePresence>{navOpen && <m.div {...fade} className="scrim" onClick={() => setNavOpen(false)} />}</AnimatePresence>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Abrir menú" onClick={() => setNavOpen(true)}><Menu /></button>
          <div className="crumbs">
            <span>{role.n}</span>
            <ChevronRight aria-hidden="true" />
            <b>{current[1]}</b>
          </div>
          <button className="top-search" onClick={() => setPalette(true)} aria-label="Buscar o ir a (Ctrl + K)">
            <Search aria-hidden="true" />
            <span className="txt">Buscar o ir a…</span>
            <span className="keys" aria-hidden="true"><Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd><Kbd>K</Kbd></span>
          </button>
          <button className="btn sec sm sim-btn" onClick={() => setSim(true)} title="Simular paso a paso el ciclo de un paciente (no cambia datos reales)">
            <CirclePlay aria-hidden="true" /> <span className="txt">Simulación</span>
          </button>
          <Notifications feed={feed} />
          <button className="icon-btn" onClick={toggle} aria-label={effective === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}>
            {effective === 'dark' ? <Sun /> : <Moon />}
          </button>
          <span className={`conn ${status.ok ? '' : 'bad'}`} title={status.msg || repo.label}>
            <i className="dot" aria-hidden="true" />
            <span className="txt">{status.ok ? (repo.kind === 'supabase' ? 'En línea' : 'Local') : 'Sin conexión'}</span>
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
        <main className="page" id="contenido">{children}</main>
      </div>

      <AnimatePresence>{palette && <CommandPalette key="palette" commands={commands} onClose={() => setPalette(false)} />}</AnimatePresence>
      <AnimatePresence>{pwd && <ChangePassword key="pwd" onClose={() => setPwd(false)} />}</AnimatePresence>
      {sim && <Suspense fallback={null}><Simulador onClose={() => setSim(false)} /></Suspense>}
      {dialog}
    </div>
  );
}
