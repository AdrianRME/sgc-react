import { useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { loginAudit } from '../store/actions.js';
import { DEMO_PASSWORD, MAX_LOGIN_ATTEMPTS, LOCK_MS, ROLES } from '../lib/constants.js';
import { Field, Msg } from '../components/ui.jsx';
import { useNow } from '../hooks/useNow.js';

export function Login() {
  const { db, run, updateSession } = useStore();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState(0);
  const now = useNow(1000);
  const locked = lockUntil > now;

  const enter = (user) => {
    updateSession({ u: user.u, view: ROLES[user.role].mods[0] });
    run(loginAudit);
  };

  const submit = (e) => {
    e.preventDefault();
    if (locked) return;
    const user = db.users.find((x) => x.u === u.trim().toLowerCase());
    let msg = '';
    if (!user || p !== DEMO_PASSWORD) msg = 'Usuario o contraseña incorrectos.';
    else if (!user.on) msg = 'El usuario está desactivado. Contacte a Jefatura.';
    if (!msg) return enter(user);
    const n = (lockUntil ? 0 : fails) + 1; // tras un bloqueo vencido, el conteo se reinicia
    if (lockUntil) setLockUntil(0);
    setFails(n);
    if (n >= MAX_LOGIN_ATTEMPTS) {
      setLockUntil(Date.now() + LOCK_MS);
      setErr(`Demasiados intentos fallidos. Acceso bloqueado temporalmente.`);
    } else {
      setErr(`${msg} Intento ${n} de ${MAX_LOGIN_ATTEMPTS}.`);
    }
  };

  const demoUsers = db.users.filter((x) => x.on);

  return (
    <div className="login">
      <div className="card">
        <div className="brand login-brand">
          <div className="logo">SGC</div>
          <div>
            <b>Sistema de Gestión Clínica</b>
            <span>Centro de Salud (demo) · PMV</span>
          </div>
        </div>
        {err && (locked || !lockUntil) && <Msg tone="crit">{err}{locked && ` Reintente en ${Math.ceil((lockUntil - now) / 1000)} s.`}</Msg>}
        <form onSubmit={submit} noValidate>
          <Field label="Usuario">
            {(a) => <input {...a} value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus disabled={locked} />}
          </Field>
          <Field label="Contraseña">
            {(a) => <input {...a} type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" disabled={locked} />}
          </Field>
          <button className="btn full" disabled={locked || !u || !p}>Ingresar</button>
        </form>

        <div className="demo-box">
          <b>Acceso rápido de demostración</b>
          <span className="note">Contraseña de todos: <code>{DEMO_PASSWORD}</code></span>
          <div className="quick">
            {demoUsers.map((x) => (
              <button key={x.u} type="button" className={`qbtn r-${x.role}`} onClick={() => enter(x)}>
                <b>{ROLES[x.role].n}</b>
                <small>{x.n}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="note">
          Prototipo: el rol se toma del usuario (RBAC). Producción: Supabase Auth / JWT, contraseñas con Argon2id.
        </p>
      </div>
      <p className="note center">
        ¿Monitor de la sala de espera? <a href="#/sala">Abrir la pantalla de sala</a>
      </p>
    </div>
  );
}
