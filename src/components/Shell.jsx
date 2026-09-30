import { useStore } from '../store/StoreProvider.jsx';
import { logoutAudit, loginAudit } from '../store/actions.js';
import { MODULES, ROLES, ACTIVE_STATES } from '../lib/constants.js';
import { useConfirm } from './ui.jsx';

export function Shell({ view, children }) {
  const { db, user, repo, status, updateSession, run, resetDemo } = useStore();
  const [ask, dialog] = useConfirm();
  const allowed = [...ROLES[user.role].mods, 'sala'];

  // Contadores en el menú: cuántos pacientes esperan en cada módulo.
  const count = {
    adm: db.turns.filter((t) => ACTIVE_STATES.includes(t.state)).length,
    enf: db.turns.filter((t) => ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE'].includes(t.state)).length,
    med: db.turns.filter((t) => ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA'].includes(t.state)).length,
  };

  const logout = () => {
    run(logoutAudit);
    updateSession({ u: null, view: null });
  };

  const switchUser = (u) => {
    const x = db.users.find((y) => y.u === u);
    updateSession({ u, view: ROLES[x.role].mods[0] });
    run(loginAudit);
  };

  return (
    <div className="shell" data-mod={view === 'sala' ? 'adm' : view}>
      <aside>
        <div className="brand">
          <div className="logo">SGC</div>
          <div>
            <b>Gestión Clínica</b>
            <span>Centro de Salud (demo)</span>
          </div>
        </div>
        <div className="me">
          <b>{user.n}</b>
          {ROLES[user.role].n}
          {user.col && ` · ${user.col}`}
        </div>
        <nav className="nav" aria-label="Módulos">
          {allowed.map((m) => (
            <button key={m} className="nb" aria-current={view === m} onClick={() => updateSession({ view: m })}>
              <span>{MODULES[m]}</span>
              {count[m] > 0 && <span className="cnt">{count[m]}</span>}
            </button>
          ))}
          <a className="nb ext" href="#/sala" target="_blank" rel="noreferrer">Sala en otra ventana ↗</a>
        </nav>
        <div className="side-foot">
          <label htmlFor="rs">Demo: cambiar de usuario</label>
          <select id="rs" value={user.u} onChange={(e) => switchUser(e.target.value)}>
            {db.users.filter((x) => x.on).map((x) => (
              <option key={x.u} value={x.u}>{ROLES[x.role].n} · {x.n}</option>
            ))}
          </select>
          <button
            className="lnk"
            onClick={() => ask({
              title: 'Restablecer datos de demostración',
              text: `Se borrarán los turnos, pacientes y registros creados${repo.kind === 'supabase' ? ' en Supabase para todos los equipos conectados' : ''}.`,
              confirmLabel: 'Restablecer',
              danger: true,
              onConfirm: resetDemo,
            })}
          >
            Restablecer datos demo
          </button>
          <button className="lnk" onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main>
        <div className="bar">
          <b>{MODULES[view]}</b>
          <span className={`pill ${status.ok ? '' : 'pill-bad'}`} title={status.msg}>
            {status.ok ? `● ${repo.label}` : '● Sin conexión con el servidor'}
          </span>
        </div>
        {children}
      </main>
      {dialog}
    </div>
  );
}
