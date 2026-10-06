import { useState } from 'react';
import { Download } from 'lucide-react';
import { useStore } from '../../store/useStore.js';
import { normalize } from '../../lib/clinical.js';
import { fmtDT, isoDay } from '../../lib/format.js';
import { toCSV } from '../../lib/analytics.js';
import { downloadText } from '../../lib/download.js';
import { WorkspaceHeader } from '../../components/WorkspaceHeader.jsx';
import { Badge, Empty, Field, Panel } from '../../components/ui.jsx';
import { BarList } from '../../components/charts/BarList.jsx';
import '../../components/charts/charts.css';
import './jefatura.css';

/** Tono de cada acción auditada (las que tocan datos clínicos o credenciales se destacan). */
const TONE = {
  HC_CONSULTADA: 'warn', ALERGIA_CONFIRMADA: 'crit', RESET_CLAVE: 'warn', USUARIO: 'info', UMBRALES: 'info',
  LOGIN: 'mut', LOGOUT: 'mut', DEMO: 'warn',
};

export default function Auditoria() {
  const { db } = useStore();
  const [fu, setFu] = useState('');
  const [fa, setFa] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const users = [...new Set(db.audit.map((a) => a.u))].sort();
  const acts = [...new Set(db.audit.map((a) => a.a))].sort();
  const nq = normalize(q.trim());
  const rows = db.audit.filter((a) => (!fu || a.u === fu) && (!fa || a.a === fa) && (!nq || normalize(`${a.d} ${a.u} ${a.a} ${a.ip}`).includes(nq)));
  const byAction = [...rows.reduce((mp, a) => mp.set(a.a, (mp.get(a.a) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const exportCSV = () =>
    downloadText(
      `sgc-auditoria-${isoDay(rows[0]?.t ?? 0)}.csv`,
      toCSV([['t', 'Fecha y hora', (r) => fmtDT(r.t)], ['u', 'Usuario'], ['ip', 'IP'], ['a', 'Acción'], ['d', 'Detalle']], rows),
      'text/csv;charset=utf-8',
    );

  return (
    <>
      <WorkspaceHeader title="Auditoría" icon="scroll" lead="Quién hizo qué, cuándo y desde qué equipo (RF-18). El autor, la hora y la IP los registra el servidor: no se pueden alterar desde el navegador." />
      <div className="grid-2 audit-grid">
        <Panel title="Eventos por acción" sub="Según los filtros aplicados">
          {byAction.length ? <BarList color="var(--cat-1)" rows={byAction.map(([k, n]) => ({ k, label: k.replaceAll('_', ' ').toLowerCase(), value: n }))} total={rows.length} /> : <Empty icon="scroll" />}
        </Panel>
        <Panel
          title="Registro de auditoría"
          count={rows.length}
          actions={<button className="btn sec sm" onClick={exportCSV} disabled={!rows.length}><Download /> Exportar CSV</button>}
        >
          <div className="toolbar">
            <Field label="Usuario">{(a) => <select {...a} value={fu} onChange={(e) => setFu(e.target.value)}><option value="">Todos</option>{users.map((u) => <option key={u}>{u}</option>)}</select>}</Field>
            <Field label="Acción">{(a) => <select {...a} value={fa} onChange={(e) => setFa(e.target.value)}><option value="">Todas</option>{acts.map((u) => <option key={u}>{u}</option>)}</select>}</Field>
            <Field label="Buscar">{(a) => <input {...a} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="TR-021, HC-000101, IP…" />}</Field>
          </div>
          {rows.length ? (
            <div className="tblw">
              <table className="tbl">
                <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>IP</th><th>Acción</th><th>Detalle</th></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDT(a.t)}</td>
                      <td className="code">{a.u}</td>
                      <td>{a.ip || '—'}</td>
                      <td><Badge tone={TONE[a.a] || 'mut'}>{a.a}</Badge></td>
                      <td className="wrap">{a.d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="search" title="Ningún evento coincide con los filtros" />}
          {rows.length > limit && <button className="btn ghost sm" onClick={() => setLimit((l) => l + 60)}>Mostrar más ({rows.length - limit} restantes)</button>}
        </Panel>
      </div>
    </>
  );
}
