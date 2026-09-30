import { useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { createUser, toggleUser, resetPassword, saveThresholds, currentThresholds } from '../store/actions.js';
import { validateThresholds } from '../lib/clinical.js';
import { ACTIVE_STATES, MIN, PRIO, ROLES, TH_FIELDS } from '../lib/constants.js';
import { fmtD, fmtDT, startOfToday } from '../lib/format.js';
import { Badge, Card, Empty, Field, Msg, useConfirm } from '../components/ui.jsx';

const TABS = [['ind', 'Indicadores'], ['usr', 'Usuarios'], ['aud', 'Auditoría'], ['umb', 'Umbrales clínicos']];

function Indicadores() {
  const { db } = useStore();
  const hoy = db.turns.filter((t) => t.t0 >= startOfToday());
  const avg = (f) => {
    const v = hoy.map(f).filter((x) => x != null && x >= 0);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length / MIN) : null;
  };
  const stages = [
    ['Espera de triaje', avg((t) => (t.tTriCall ? t.tTriCall - t.t0 : null))],
    ['Triaje', avg((t) => (t.tTriSave && t.tTriCall ? t.tTriSave - t.tTriCall : null))],
    ['Espera de consulta', avg((t) => (t.tMedCall && t.tTriSave ? t.tMedCall - t.tTriSave : null))],
    ['Consulta', avg((t) => (t.tEnd && t.tMedCall ? t.tEnd - t.tMedCall : null))],
  ];
  const mx = Math.max(1, ...stages.map((s) => s[1] || 0));
  const total = avg((t) => (t.tEnd ? t.tEnd - t.t0 : null));
  const byPrio = Object.keys(PRIO).map((k) => [k, hoy.filter((t) => t.prio === k).length]);
  const kpis = [
    [hoy.length, 'Turnos generados hoy'],
    [db.turns.filter((t) => ['EN_ESPERA_TRIAJE', 'EN_ESPERA_CONSULTA'].includes(t.state)).length, 'En espera ahora'],
    [hoy.filter((t) => t.state === 'ATENDIDO').length, 'Atendidos hoy'],
    [hoy.filter((t) => t.state === 'CANCELADO').length, 'Cancelados / no se presentó'],
    [total != null ? `${total} min` : '—', 'Tiempo total medio (llegada → alta)'],
  ];
  return (
    <>
      <div className="kpis">
        {kpis.map(([v, l]) => <div className="kpi" key={l}><b>{v}</b><span>{l}</span></div>)}
      </div>
      <div className="grid">
        <Card title="Tiempo medio por etapa (hoy)">
          <div className="bars">
            {stages.map(([l, v]) => (
              <div className="r" key={l}>
                <span>{l}</span>
                <div className="t"><i style={{ width: `${Math.round(((v || 0) / mx) * 100)}%` }} /></div>
                <b>{v != null ? `${v} min` : '—'}</b>
              </div>
            ))}
          </div>
          <p className="note">Se calcula con las marcas de tiempo reales de cada turno (RF-17).</p>
        </Card>
        <Card title="Pacientes por prioridad (hoy)">
          <div className="bars">
            {byPrio.map(([k, n]) => (
              <div className="r" key={k}>
                <span><Badge tone={PRIO[k][1]}>{PRIO[k][0]}</Badge></span>
                <div className="t"><i className={`p-${k}`} style={{ width: `${hoy.length ? Math.round((n / hoy.length) * 100) : 0}%` }} /></div>
                <b>{n}</b>
              </div>
            ))}
          </div>
          <p className="note">Pacientes activos en este momento: {db.turns.filter((t) => ACTIVE_STATES.includes(t.state)).length}.</p>
        </Card>
      </div>
    </>
  );
}

function Usuarios() {
  const { db, run, user } = useStore();
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState({ u: '', n: '', role: 'adm', col: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(createUser, f);
    if (r.ok) setF({ u: '', n: '', role: 'adm', col: '' });
  };
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

  return (
    <div className="grid">
      <Card title={`Usuarios del sistema (${db.users.length})`}>
        <div className="tblw">
          <table>
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Colegiatura</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {db.users.map((x) => (
                <tr key={x.u}>
                  <td className="code">{x.u}</td>
                  <td>{x.n}{x.u === user.u && ' (usted)'}</td>
                  <td>{ROLES[x.role]?.n}</td>
                  <td>{x.col || '—'}</td>
                  <td><Badge tone={x.on ? 'ok' : 'mut'}>{x.on ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td className="td-a">
                    <button className="btn sec sm" onClick={() => toggle(x)} disabled={x.u === user.u}>{x.on ? 'Desactivar' : 'Activar'}</button>
                    <button className="btn ghost sm" onClick={() => run(resetPassword, x.u)}>Restablecer clave</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Nuevo usuario">
        <form onSubmit={submit} noValidate>
          <div className="row">
            <Field label="Usuario" hint="4–20 caracteres: a-z, 0-9, punto o guion bajo">
              {(a) => <input {...a} value={f.u} onChange={set('u')} placeholder="p.ejemplo" autoComplete="off" />}
            </Field>
            <Field label="Nombre completo">{(a) => <input {...a} value={f.n} onChange={set('n')} />}</Field>
          </div>
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
          <button className="btn" disabled={!f.u || !f.n}>Crear usuario</button>
          <p className="note">La contraseña temporal se entrega al usuario y debe cambiarse en su primer ingreso.</p>
        </form>
      </Card>
      {dialog}
    </div>
  );
}

function Auditoria() {
  const { db } = useStore();
  const [fu, setFu] = useState('');
  const [fa, setFa] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const users = [...new Set(db.audit.map((a) => a.u))].sort();
  const acts = [...new Set(db.audit.map((a) => a.a))].sort();
  const rows = db.audit.filter(
    (a) => (!fu || a.u === fu) && (!fa || a.a === fa) && (!q || `${a.d} ${a.u} ${a.a}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <Card title={`Registro de auditoría (RF-18) · ${rows.length} eventos`}>
      <div className="row s">
        <Field label="Usuario">{(a) => <select {...a} value={fu} onChange={(e) => setFu(e.target.value)}><option value="">Todos</option>{users.map((u) => <option key={u}>{u}</option>)}</select>}</Field>
        <Field label="Acción">{(a) => <select {...a} value={fa} onChange={(e) => setFa(e.target.value)}><option value="">Todas</option>{acts.map((u) => <option key={u}>{u}</option>)}</select>}</Field>
        <Field label="Buscar">{(a) => <input {...a} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="TR-045, HC-000101…" />}</Field>
      </div>
      {rows.length ? (
        <div className="tblw">
          <table>
            <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>IP</th><th>Acción</th><th>Detalle</th></tr></thead>
            <tbody>
              {rows.slice(0, limit).map((a) => (
                <tr key={a.id}><td>{fmtDT(a.t)}</td><td className="code">{a.u}</td><td>{a.ip}</td><td>{a.a}</td><td className="wrap">{a.d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>Ningún evento coincide con los filtros.</Empty>}
      {rows.length > limit && <button className="btn ghost sm" onClick={() => setLimit((l) => l + 50)}>Mostrar más ({rows.length - limit} restantes)</button>}
    </Card>
  );
}

function Umbrales() {
  const { db, run } = useStore();
  const cur = currentThresholds(db);
  const hist = [...db.thresholds].sort((a, b) => b.since - a.since);
  const [v, setV] = useState(() => Object.fromEntries(Object.entries(cur).map(([k, x]) => [k, String(x)])));
  const [by, setBy] = useState(hist[0]?.by || '');
  const nums = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, +x]));
  const errs = validateThresholds(nums);
  const dirty = Object.keys(cur).some((k) => +v[k] !== cur[k]);

  return (
    <div className="grid">
      <Card title="Umbrales de triaje (RF-08)">
        <Msg tone="warn">Los valores deben ser definidos y aprobados por el responsable clínico. Los de este prototipo son de demostración.</Msg>
        <form onSubmit={(e) => { e.preventDefault(); run(saveThresholds, nums, by); }} noValidate>
          <div className="tblw">
            <table className="th-table">
              <thead><tr><th>Parámetro</th><th>Crítico → CRÍTICA</th><th>Alerta → PRIORITARIA</th></tr></thead>
              <tbody>
                {TH_FIELDS.map(([c, a, label, rule, step]) => (
                  <tr key={c}>
                    <td className="wrap"><b>{label}</b><br /><small className="hint">{rule}</small></td>
                    <td><input type="number" step={step} aria-label={`${label} crítico`} value={v[c]} onChange={(e) => setV((x) => ({ ...x, [c]: e.target.value }))} /></td>
                    <td><input type="number" step={step} aria-label={`${label} alerta`} value={v[a]} onChange={(e) => setV((x) => ({ ...x, [a]: e.target.value }))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errs.length > 0 && <Msg tone="crit">{errs.map((e) => <div key={e}>{e}</div>)}</Msg>}
          <Field label="Aprobado por (médico responsable)">{(a) => <input {...a} value={by} onChange={(e) => setBy(e.target.value)} />}</Field>
          <button className="btn" disabled={!!errs.length || !dirty || !by.trim()}>Guardar y registrar aprobación</button>
          {!dirty && <span className="note inline-note">Sin cambios respecto a la versión vigente.</span>}
        </form>
      </Card>
      <Card title="Historial de versiones">
        <div className="list">
          {hist.map((h, i) => (
            <div className="item" key={h.id}>
              <div className="l">
                <span>{fmtD(h.since)} · {h.by}</span>
                <small>SpO₂ &lt; {h.vals.spo2} · T ≥ {h.vals.tmp} · PAS &lt; {h.vals.pasLo} · FC &gt; {h.vals.fcHi} · FR &gt; {h.vals.frHi}</small>
              </div>
              <Badge tone={i === 0 ? 'ok' : 'mut'}>{i === 0 ? 'Vigente' : 'Anterior'}</Badge>
            </div>
          ))}
        </div>
        <p className="note">Cada cambio cierra la vigencia anterior y queda registrado en la auditoría.</p>
      </Card>
    </div>
  );
}

export function Jefatura() {
  const [tab, setTab] = useState('ind');
  return (
    <div className="content">
      <h1>Jefatura</h1>
      <p className="sub">Indicadores, administración de usuarios, umbrales clínicos y trazabilidad de acciones.</p>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'ind' && <Indicadores />}
      {tab === 'usr' && <Usuarios />}
      {tab === 'aud' && <Auditoria />}
      {tab === 'umb' && <Umbrales />}
    </div>
  );
}
