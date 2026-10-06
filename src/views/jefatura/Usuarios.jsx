import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { KeyRound, Power, UserPlus } from 'lucide-react';
import { useStore } from '../../store/useStore.js';
import { createUser, toggleUser, resetPassword } from '../../store/actions.js';
import { normalize } from '../../lib/clinical.js';
import { ROLES } from '../../lib/constants.js';
import { listItem } from '../../lib/motion.js';
import { WorkspaceHeader } from '../../components/WorkspaceHeader.jsx';
import { Avatar, Badge, Empty, Field, Panel, Segmented } from '../../components/ui.jsx';
import { Modal } from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { Icon3D } from '../../components/Icon3D.jsx';
import './jefatura.css';

const EMPTY = { u: '', n: '', role: 'adm', col: '' };

export default function Usuarios() {
  const { db, run, user } = useStore();
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(EMPTY);
  const [cred, setCred] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const r = await run(createUser, f);
    if (r.ok) {
      setF(EMPTY);
      setCred({ ...r.result, nuevo: true });
    }
  };
  const reset = (x) =>
    ask({
      title: `Restablecer la contraseña de ${x.u}`,
      icon: 'locked',
      text: 'Se generará una contraseña temporal y se cerrarán sus sesiones abiertas. Deberá cambiarla al ingresar.',
      confirmLabel: 'Generar contraseña temporal',
      onConfirm: async () => {
        const r = await run(resetPassword, x.u);
        if (r.ok) setCred(r.result);
      },
    });
  const toggle = (x) =>
    x.on
      ? ask({
          title: `Desactivar a ${x.u}`,
          text: `${x.n} no podrá ingresar al sistema hasta que se reactive.`,
          confirmLabel: 'Desactivar',
          danger: true,
          onConfirm: () => run(toggleUser, x.u),
        })
      : run(toggleUser, x.u);

  const nq = normalize(q.trim());
  const list = db.users.filter((x) => (!role || x.role === role) && (!nq || normalize(`${x.u} ${x.n} ${x.col}`).includes(nq)));
  const counts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, db.users.filter((x) => x.role === k).length]));

  return (
    <>
      <WorkspaceHeader title="Usuarios" icon="people" lead="Cree las cuentas del personal, active o desactive el acceso y genere contraseñas temporales. Cada cuenta abre solo el espacio de su rol." />
      <div className="grid-2 side-r">

        <Panel
          title="Personal del sistema"
          count={list.length}
          actions={
            <>
              <input className="input sm-select search-sm" type="search" placeholder="Buscar por nombre o usuario" aria-label="Buscar usuario" value={q} onChange={(e) => setQ(e.target.value)} />
              <Segmented label="Filtrar por rol" value={role} onChange={setRole} options={[['', 'Todos'], ...Object.entries(ROLES).map(([k, r]) => [k, r.n, counts[k]])]} />
            </>
          }
        >
          {list.length ? (
            <div className="tblw">
              <table className="tbl">
                <thead><tr><th>Persona</th><th>Rol</th><th>Colegiatura</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {list.map((x) => (
                      <m.tr key={x.u} {...listItem} layout="position">
                        <td>
                          <div className="user-cell" data-role={x.role}>
                            <Avatar name={x.n} />
                            <div><b>{x.n}{x.u === user.u && ' (usted)'}</b><small className="code">{x.u}</small></div>
                          </div>
                        </td>
                        <td><span data-role={x.role}><Badge tone="role">{ROLES[x.role]?.n}</Badge></span></td>
                        <td className="nowrap">{x.col || '—'}</td>
                        <td><Badge tone={x.on ? 'ok' : 'mut'}>{x.on ? 'Activo' : 'Inactivo'}</Badge></td>
                        <td>
                          <div className="row-acts">
                            <button className="btn sec sm" onClick={() => toggle(x)} disabled={x.u === user.u}><Power /> {x.on ? 'Desactivar' : 'Activar'}</button>
                            <button className="icon-btn sm" onClick={() => reset(x)} aria-label={`Restablecer la contraseña de ${x.u}`} title="Restablecer contraseña"><KeyRound /></button>
                          </div>
                        </td>
                      </m.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ) : <Empty icon="search" title="Nadie coincide con la búsqueda" />}
        </Panel>
        <Panel title="Nuevo usuario" icon="sparkles">
          <form onSubmit={submit} noValidate className="stack">
            <Field label="Usuario" hint="De 4 a 20 caracteres: letras minúsculas, números, punto o guion bajo">
              {(a) => <input {...a} value={f.u} onChange={set('u')} placeholder="p.ejemplo" autoComplete="off" />}
            </Field>
            <Field label="Nombre completo">{(a) => <input {...a} value={f.n} onChange={set('n')} />}</Field>
            <div className="row">
              <Field label="Rol">
                {(a) => (
                  <select {...a} value={f.role} onChange={set('role')}>
                    {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.n}</option>)}
                  </select>
                )}
              </Field>
              <Field label={`Colegiatura${f.role === 'med' ? ' (obligatoria)' : ''}`}>
                {(a) => <input {...a} value={f.col} onChange={set('col')} placeholder={f.role === 'enf' ? 'CEP-00000' : 'CMP-00000'} disabled={!['med', 'enf'].includes(f.role)} />}
              </Field>
            </div>
            <div className="actions">
              <button className="btn" disabled={!f.u || !f.n}><UserPlus /> Crear usuario</button>
            </div>
            <p className="note">La contraseña temporal se muestra una sola vez y debe cambiarse en el primer ingreso.</p>
          </form>
        </Panel>
      </div>
      {dialog}
      <AnimatePresence>
        {cred && (
          <Modal key="cred" label="Contraseña temporal" onClose={() => setCred(null)} size="sm">
            <Icon3D name="locked" size={48} className="head-icon" />
            <h3>{cred.nuevo ? 'Usuario creado' : 'Contraseña restablecida'}</h3>
            <p>Entregue estos datos a la persona por un medio seguro. La contraseña se muestra <b>una sola vez</b> y deberá cambiarla en su primer ingreso.</p>
            <div className="cred">
              <span>Usuario</span><b className="code">{cred.u}</b>
              <span>Contraseña temporal</span><b className="code">{cred.clave}</b>
            </div>
            <div className="actions end">
              <button className="btn" onClick={() => setCred(null)}>Listo</button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  );
}
