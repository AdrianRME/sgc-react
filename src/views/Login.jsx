import { lazy, Suspense, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { CalendarPlus, ChevronRight, CirclePlay, Eye, EyeOff, KeyRound, Lock, LogIn, Tv, Zap } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { ACCESO_DEMO, DEMO_PASSWORD, ESP_POR_RAMA, MAX_LOGIN_ATTEMPTS, LOCK_MS, ROLES, roleFromUsername } from '../lib/constants.js';
import { CUENTAS_RAPIDAS, nombreCorto } from '../lib/cuentasDemo.js';
import { initials } from '../lib/format.js';
import { Field, Msg } from '../components/ui.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import { useNow } from '../hooks/useNow.js';
import './login.css';

// El simulador no necesita sesión: corre sobre una copia de prueba de los datos
const Simulador = lazy(() => import('../components/Simulador.jsx'));

/**
 * Personas de un área para el acceso rápido. En Consulta se agrupan por especialidad, en el orden de las ramas.
 * [{ titulo, cuentas }]
 */
function personasDe(role) {
  const cuentas = CUENTAS_RAPIDAS.filter((x) => x.role === role);
  if (role !== 'med') return [{ titulo: null, cuentas }];
  return ESP_POR_RAMA.flatMap((r) => r.esps)
    .map((e) => ({ titulo: e.n, cuentas: cuentas.filter((x) => x.esp === e.k) }))
    .filter((g) => g.cuentas.length);
}

/*
 * Fondo: la pantalla de un monitor de signos vitales. Tres trazos (ECG en derivación II, pletismografía de
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

const VITALES = [
  ['fc', 'FC', '72', 'lpm'],
  ['spo2', 'SpO₂', '98', '%'],
  ['pa', 'PA', '118/76', 'mmHg'],
  ['fr', 'FR', '16', 'rpm'],
  ['t', 'T°', '36.8', '°C'],
];

function Monitor() {
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
        </defs>
        <g mask="url(#sweep-mask)">
          {TRAZOS.map((t) => <path key={t.k} className={`tr tr-${t.k}`} d={t.d} />)}
        </g>
      </svg>
      {TRAZOS.map((t) => (
        <span key={t.k} className={`tr-l tr-${t.k}`} style={{ top: `${(t.y - 90) / 6}%` }}>{t.label}</span>
      ))}
      <dl className="vitals">
        {VITALES.map(([k, n, v, u]) => (
          <div key={k} className={`vt vt-${k}`}>
            <dt>{n}{k === 'fc' && <i className="beat">♥</i>}</dt>
            <dd><b>{v}</b><small>{u}</small></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Login() {
  const { signIn } = useStore();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [sim, setSim] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Con el acceso rápido, el formulario de usuario y contraseña queda a un clic («Ingresar con mi contraseña»)
  const [manual, setManual] = useState(!ACCESO_DEMO);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const now = useNow(1000);
  const locked = lockUntil > now;
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

  const entrar = async (usuario, clave) => {
    if (locked || busy) return;
    setBusy(true);
    try {
      await signIn(usuario, clave);
    } catch (x) {
      const n = (lockUntil ? 0 : fails) + 1; // tras un bloqueo vencido, el conteo se reinicia
      if (lockUntil) setLockUntil(0);
      setFails(n);
      if (n >= MAX_LOGIN_ATTEMPTS) {
        setLockUntil(() => Date.now() + LOCK_MS); // al fallar, no durante el render
        setErr('Demasiados intentos fallidos. Acceso bloqueado temporalmente.');
      } else {
        setErr(`${x.message} Intento ${n} de ${MAX_LOGIN_ATTEMPTS}.`);
      }
      setP('');
    } finally {
      setBusy(false);
    }
  };
  const submit = (e) => {
    e.preventDefault();
    entrar(u, p);
  };
  /** Acceso rápido: entra con la cuenta compartida de esa persona, sin escribir nada. */
  const entrarComo = (x) => {
    setU(x.u);
    entrar(x.u, DEMO_PASSWORD);
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
          <a className="sala-link" href="#/sala"><Tv aria-hidden="true" /> Pantalla de sala</a>
          <button type="button" className="sala-link" onClick={() => setSim(true)}><CirclePlay aria-hidden="true" /> Simulación</button>
        </nav>
      </header>
      {sim && <Suspense fallback={null}><Simulador onClose={() => setSim(false)} /></Suspense>}

      <main className="login-main">
        <m.div className="login-card" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
          <div className="who" aria-live="polite">
            <span className="who-av">
              <AnimatePresence mode="popLayout" initial={false}>
                <m.span
                  key={role || 'none'}
                  initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.4, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                >
                  <Icon3D name={R ? R.icon : 'hospital'} size={58} />
                </m.span>
              </AnimatePresence>
            </span>
            <h1>{R ? R.n : 'Bienvenido'}</h1>
            <p>{R ? R.tag : ACCESO_DEMO && !manual ? 'Elija su área para empezar' : 'Ingrese con su usuario institucional'}</p>
          </div>

          {err && (locked || !lockUntil) && (
            <Msg tone="crit">{err}{locked && ` Reintente en ${Math.ceil((lockUntil - now) / 1000)} s.`}</Msg>
          )}
          <div className="stack">
            <div className="areas" role="group" aria-label="Área de trabajo">
              {AREAS_LOGIN.map(([k, n]) => (
                <button key={k} type="button" className="area-btn" data-role={k} aria-pressed={role === k} onClick={() => pickArea(k)} disabled={locked}>
                  <Icon3D name={ROLES[k].icon} size={26} />
                  <span>{n}</span>
                </button>
              ))}
            </div>
          {!manual && (
            <div className="rapido">
              {role ? (
                <div className="personas" role="group" aria-label={`Personal de ${R.n}`}>
                  {personasDe(role).map((g) => (
                    <div key={g.titulo || role} className="personas-g">
                      {g.titulo && <span className="personas-t">{g.titulo}</span>}
                      {g.cuentas.map((x) => (
                        <button key={x.u} type="button" className="persona" onClick={() => entrarComo(x)} disabled={locked || busy}>
                          <span className="persona-av" aria-hidden="true">{initials(nombreCorto(x.n))}</span>
                          <span className="persona-n"><b>{nombreCorto(x.n)}</b><small>{busy && u === x.u ? 'Ingresando…' : x.u}</small></span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rapido-ayuda"><Zap aria-hidden="true" /> Elija su área y luego su nombre: entra con un clic, sin contraseña.</p>
              )}
              <button type="button" className="lnk-login" onClick={() => setManual(true)}><KeyRound aria-hidden="true" /> Ingresar con usuario y contraseña</button>
            </div>
          )}
          </div>
          {manual && (
          <form onSubmit={submit} noValidate className="stack">
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
            {ACCESO_DEMO && <button type="button" className="lnk-login" onClick={() => setManual(false)}><Zap aria-hidden="true" /> Volver al acceso rápido</button>}
          </form>
          )}

          <p className="sec-note"><Lock aria-hidden="true" /> {ACCESO_DEMO ? 'Prototipo con datos ficticios' : 'Conexión cifrada'} · la sesión se cierra tras 15 min sin uso</p>
        </m.div>
      </main>
    </div>
  );
}
