import { useState } from 'react';
import { m } from 'motion/react';
import { Eye, EyeOff, LogIn, ShieldCheck, Tv } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { DEMO_PASSWORD, MAX_LOGIN_ATTEMPTS, LOCK_MS, ROLES } from '../lib/constants.js';
import { Field, Msg } from '../components/ui.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import { useNow } from '../hooks/useNow.js';
import './login.css';

// Cuentas de demostración (solo se muestran en modo local de desarrollo)
const DEV_USERS = [['a.admision', 'adm'], ['e.triaje', 'enf'], ['m.consulta', 'med'], ['j.jefatura', 'jef']];

/** Estaciones de la ruta en la portada. */
const STATIONS = [
  ['adm', 'Admisión', 'idcard', 'DNI, SIS y turno'],
  ['enf', 'Triaje', 'thermometer', 'Signos y prioridad'],
  ['med', 'Consulta', 'stethoscope', 'Diagnóstico y receta'],
  ['jef', 'Alta', 'check', 'Destino del paciente'],
];

/** La ruta se dibuja una sola vez al abrir: es el único movimiento que no responde a una acción. */
function RouteArt() {
  return (
    <ol className="route-art" aria-label="Ruta del paciente: admisión, triaje, consulta y alta">
      {STATIONS.map(([k, n, icon, sub], i) => (
        <li key={k} style={{ '--c': `var(--st-${k})` }}>
          {i > 0 && (
            <m.i
              className="ra-line"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.1 + i * 0.2, duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            />
          )}
          <m.div
            className="ra-stop"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.05 + i * 0.2 + (i ? 0.25 : 0), type: 'spring', stiffness: 460, damping: 24 }}
          >
            <Icon3D name={icon} size={46} />
          </m.div>
          <b>{n}</b>
          <span>{sub}</span>
        </li>
      ))}
    </ol>
  );
}

export function Login() {
  const { signIn, repo } = useStore();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const now = useNow(1000);
  const locked = lockUntil > now;
  const local = repo.kind === 'local';

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
    <div className="login">
      <section className="login-hero">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Sistema de Gestión Clínica</span></div>
        </div>
        <div className="hero-copy">
          <h1>La ruta del paciente, de la puerta a la receta.</h1>
          <p>Admisión, triaje, consulta y alta conectados en tiempo real en el Centro de Salud de primer nivel.</p>
        </div>
        <RouteArt />
        <ul className="login-facts">
          <li><Icon3D name="shield" size={28} />Cada rol trabaja en su propio espacio y solo ve lo que necesita.</li>
          <li><Icon3D name="thermometer" size={28} />La prioridad de triaje la calcula el sistema con umbrales aprobados por un médico.</li>
          <li><Icon3D name="tv" size={28} />La pantalla de sala muestra códigos de turno, nunca nombres.</li>
        </ul>
      </section>

      <section className="login-side">
        <div className="login-card">
          <h2>Ingresar</h2>
          <p className="note">Use su usuario institucional. Cada rol abre su propio espacio de trabajo.</p>
          {err && (locked || !lockUntil) && (
            <Msg tone="crit">{err}{locked && ` Reintente en ${Math.ceil((lockUntil - now) / 1000)} s.`}</Msg>
          )}
          <form onSubmit={submit} noValidate className="stack">
            <Field label="Usuario" hint="Por ejemplo: a.admision">
              {(a) => <input {...a} value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus disabled={locked} />}
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
              <LogIn /> {busy ? 'Verificando…' : 'Ingresar'}
            </button>
          </form>

          {local ? (
            <div className="demo-box">
              <b>Modo local de desarrollo</b>
              <span className="note">Sin Supabase configurado. Contraseña de las cuentas: <code>{DEMO_PASSWORD}</code></span>
              <div className="quick">
                {DEV_USERS.map(([x, r]) => (
                  <button key={x} type="button" className="qbtn" data-role={r} onClick={() => { setU(x); setP(DEMO_PASSWORD); }}>
                    <Icon3D name={ROLES[r].icon} size={30} />
                    <span><b>{ROLES[r].n}</b><small>{x}</small></span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="sec-note">
              <ShieldCheck aria-hidden="true" />
              Conexión cifrada (HTTPS) y contraseñas protegidas con bcrypt en Supabase Auth. La sesión se cierra al cerrar la pestaña o tras 15 minutos sin actividad.
            </p>
          )}
        </div>
        <a className="sala-link" href="#/sala"><Tv aria-hidden="true" /> Abrir la pantalla de la sala de espera</a>
      </section>
    </div>
  );
}
