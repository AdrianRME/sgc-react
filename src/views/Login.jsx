import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { CalendarPlus, CirclePlay, Eye, EyeOff, Lock, LogIn, Tv, UserRound } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { DEMO_PASSWORD, MAX_LOGIN_ATTEMPTS, LOCK_MS, ROLES, roleFromUsername } from '../lib/constants.js';
import { cambio, entrada } from '../lib/motion.js';
import { Field, Msg } from '../components/ui.jsx';
import { Icono } from '../components/Icono.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import { useNow } from '../hooks/useNow.js';
import '../styles/vistas/login.css';

// El simulador no necesita sesión: corre sobre una copia de prueba de los datos
const Simulador = lazy(() => import('../components/Simulador.jsx'));

// Cuentas de demostración (solo se muestran en modo local de desarrollo)
const DEV_USERS = [['a.admision', 'adm'], ['c.caja', 'caj'], ['e.triaje', 'enf'], ['m.consulta', 'med'], ['m.cardio', 'med'], ['j.jefatura', 'jef']];

/*
 * Fondo (animaciones en styles/motion.css): la pantalla de un monitor de signos vitales. Tres trazos (ECG en derivación II, pletismografía de
 * la oximetría y respiración) con la barra de barrido que los va borrando, y las cifras a la derecha.
 * Son decorativos: no muestran datos de ningún paciente.
 */
const BEAT = 'l70 0 q12 -14 24 0 l18 0 l6 12 l10 -82 l10 104 l8 -34 l26 0 q18 -26 36 0 l92 0'; // 300 de ancho
const PLETH = 'c30 0 40 -60 70 -60 c25 0 35 38 50 42 c8 2 14 -9 22 -7 c20 4 60 25 158 25'; // 300 de ancho
const times = (s, n) => Array.from({ length: n }, () => s).join(' ');
const TRAZOS = [
  { k: 'ecg', label: 'II', d: `M0 170 ${times(BEAT, 4)}`, y: 170 },
  { k: 'pleth', label: 'Pleth', d: `M-60 360 ${times(PLETH, 5)}`, y: 360 },
  { k: 'resp', label: 'Resp', d: `M0 500 q150 -38 300 0 ${times('t300 0', 3)}`, y: 500 },
];
/** Áreas que se pueden elegir para no escribir el prefijo (no revelan ninguna cuenta: las áreas son públicas). */
const AREAS_LOGIN = [['adm', 'Admisión'], ['caj', 'Caja'], ['enf', 'Triaje'], ['med', 'Consulta'], ['jef', 'Jefatura']];

/** Signos del monitor: [clave, rótulo, unidad, valor central, variación, decimales]. La PA lleva dos cifras. */
const VITALES = [
  ['fc', 'FC', 'lpm', 72, 3, 0],
  ['spo2', 'SpO₂', '%', 98, 1, 0],
  ['pa', 'PA', 'mmHg', [118, 76], 3, 0],
  ['fr', 'FR', 'rpm', 16, 1, 0],
  ['t', 'T°', '°C', 36.8, 0.1, 1],
];
const vaiven = (centro, d, dec) => (centro + (Math.random() * 2 - 1) * d).toFixed(dec);
const leer = ([, , , centro, d, dec]) => (Array.isArray(centro) ? centro.map((c) => vaiven(c, d, dec)).join('/') : vaiven(centro, d, dec));
const CENTRO = VITALES.map(([, , , c, , dec]) => (Array.isArray(c) ? c.join('/') : c.toFixed(dec)));

/**
 * Las cifras del monitor varían un poco cada par de segundos, como en un monitor real (cada una a su ritmo).
 * Son decorativas. Con «reducir movimiento» se quedan fijas en su valor central.
 */
function useVitales() {
  const [v, setV] = useState(CENTRO);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      // En cada tic cambia uno o dos signos, no todos a la vez
      setV((prev) => prev.map((x, i) => ((n + i) % 3 === 0 || i === 0 ? leer(VITALES[i]) : x)));
    }, 1700);
    return () => clearInterval(id);
  }, []);
  return v;
}

function Monitor() {
  const valores = useVitales();
  return (
    <div className="login-bg" aria-hidden="true">
      <svg className="mon" viewBox="0 0 1200 600" preserveAspectRatio="none">
        {/* La barra de barrido es una máscara: borra los trazos y deja ver la cuadrícula */}
        <defs>
          <linearGradient id="sweep-fade" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.4" stopColor="#000" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="sweep-mask" maskUnits="userSpaceOnUse" x="-100" y="0" width="1400" height="600">
            <rect x="-100" y="0" width="1400" height="600" fill="#fff" />
            <rect className="sweep" x="0" y="0" width="60" height="600" fill="url(#sweep-fade)" />
          </mask>
          <linearGradient id="sweep-luz" x1="0" x2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <g mask="url(#sweep-mask)">
          {TRAZOS.map((t) => <path key={t.k} className={`tr tr-${t.k}`} d={t.d} />)}
        </g>
        {/* La luz del barrido: una franja tenue que va justo delante de lo que se borra */}
        <rect className="sweep sweep-luz" x="-30" y="0" width="30" height="600" fill="url(#sweep-luz)" />
      </svg>
      {TRAZOS.map((t) => (
        <span key={t.k} className={`tr-l tr-${t.k}`} style={{ top: `${(t.y - 90) / 6}%` }}>{t.label}</span>
      ))}
      <dl className="vitals">
        {VITALES.map(([k, n, u], i) => (
          <div key={k} className={`vt vt-${k}`}>
            <dt>{n}{k === 'fc' && <i className="beat">♥</i>}</dt>
            {/* La clave cambia con el valor: así la cifra nueva entra con su animación */}
            <dd><b key={valores[i]}>{valores[i]}</b><small>{u}</small></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Login() {
  const { signIn, repo } = useStore();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [sim, setSim] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const now = useNow(1000);
  const locked = lockUntil > now;
  const local = repo.kind === 'local';
  const role = roleFromUsername(u);
  const R = role && ROLES[role];
  const userRef = useRef(null);

  /** Pone el prefijo del área (conservando lo ya escrito después del prefijo) y deja el cursor al final. */
  const pickArea = (k) => {
    const resto = role ? u.trim().slice(ROLES[role].prefix.length) : '';
    const next = ROLES[k].prefix + resto;
    setU(next);
    requestAnimationFrame(() => {
      const el = userRef.current;
      el?.focus();
      el?.setSelectionRange(next.length, next.length);
    });
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (locked || busy) return;
    setBusy(true);
    try {
      await signIn(u, p);
    } catch (x) {
      const n = (lockUntil ? 0 : fails) + 1; // tras un bloqueo vencido, el conteo se reinicia
      if (lockUntil) setLockUntil(0);
      setFails(n);
      if (n >= MAX_LOGIN_ATTEMPTS) {
        setLockUntil(Date.now() + LOCK_MS);
        setErr('Demasiados intentos fallidos. Acceso bloqueado temporalmente.');
      } else {
        setErr(`${x.message} Intento ${n} de ${MAX_LOGIN_ATTEMPTS}.`);
      }
      setP('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login" data-role={role || undefined}>
      <Monitor />

      <header className="login-top">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Centro de Salud</span></div>
        </div>
        <nav className="top-links">
          <a className="sala-link cita" href="#/cita"><CalendarPlus aria-hidden="true" /> Sacar cita</a>
          <a className="sala-link" href="#/paciente"><UserRound aria-hidden="true" /> Mi atención</a>
          <a className="sala-link" href="#/sala"><Tv aria-hidden="true" /> Pantalla de sala</a>
          <button type="button" className="sala-link" onClick={() => setSim(true)}><CirclePlay aria-hidden="true" /> Simulación</button>
        </nav>
      </header>
      {sim && <Suspense fallback={null}><Simulador onClose={() => setSim(false)} /></Suspense>}

      <main className="login-main">
        <m.div className="login-card" {...entrada}>
          <div className="who" aria-live="polite">
            <span className="who-av">
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span key={role || 'none'} {...cambio}>
                  <Icono name={R ? R.icon : 'hospital'} size={56} />
                </m.span>
              </AnimatePresence>
            </span>
            <h1>{R ? R.n : 'Bienvenido'}</h1>
            <p>{R ? R.tag : 'Ingrese con su usuario institucional'}</p>
          </div>

          {err && (locked || !lockUntil) && (
            <Msg tone="crit">{err}{locked && ` Reintente en ${Math.ceil((lockUntil - now) / 1000)} s.`}</Msg>
          )}
          <form onSubmit={submit} noValidate className="stack">
            <div className="areas" role="group" aria-label="Área de trabajo">
              {AREAS_LOGIN.map(([k, n]) => (
                <button key={k} type="button" className="area-btn" data-role={k} aria-pressed={role === k} onClick={() => pickArea(k)} disabled={locked}>
                  <Icono name={ROLES[k].icon} size={20} />
                  <span>{n}</span>
                </button>
              ))}
            </div>
            <Field label="Usuario">
              {(a) => (
                <input
                  {...a} ref={userRef} value={u} onChange={(e) => setU(e.target.value)} placeholder="Elija su área o escriba su usuario"
                  // En equipos compartidos el navegador no debe sugerir los usuarios que otros escribieron
                  autoComplete="off" autoCapitalize="none" spellCheck="false" autoFocus disabled={locked}
                />
              )}
            </Field>
            <Field label="Contraseña">
              {(a) => (
                <div className="pw">
                  <input {...a} type={show ? 'text' : 'password'} value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" disabled={locked} />
                  <button type="button" className="icon-btn sm" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              )}
            </Field>
            <button className="btn lg full" disabled={locked || busy || !u || !p}>
              <LogIn /> {busy ? 'Verificando…' : R ? `Ingresar a ${R.n}` : 'Ingresar'}
            </button>
          </form>

          {local ? (
            <div className="demo-box">
              <span className="note">Cuentas de prueba · clave <code>{DEMO_PASSWORD}</code></span>
              <div className="quick">
                {DEV_USERS.map(([x, r]) => (
                  <button key={x} type="button" className="qbtn" data-role={r} title={x} aria-pressed={u === x} onClick={() => { setU(x); setP(DEMO_PASSWORD); }}>
                    <Icono name={ROLES[r].icon} size={20} />
                    <span>{x === 'm.cardio' ? 'Cardiología' : ROLES[r].n}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="sec-note"><Lock aria-hidden="true" /> Conexión cifrada · la sesión se cierra tras 15 min sin uso</p>
          )}
        </m.div>
      </main>
    </div>
  );
}
