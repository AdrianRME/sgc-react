import { useState } from 'react';
import { Save } from 'lucide-react';
import { useStore } from '../../store/useStore.js';
import { saveThresholds, currentThresholds } from '../../store/actions.js';
import { validateThresholds } from '../../lib/clinical.js';
import { TH_FIELDS } from '../../lib/constants.js';
import { fmtD } from '../../lib/format.js';
import { WorkspaceHeader } from '../../components/WorkspaceHeader.jsx';
import { Badge, Field, Msg, Panel } from '../../components/ui.jsx';
import '../../components/charts/charts.css';
import './jefatura.css';

/**
 * Escala visual de cada signo con sus zonas (normal, alerta, crítico) según los valores que se editan.
 * Los límites fijos (FC < 40, FR < 8) son los mismos de la regla de triaje (clinical.js).
 */
const SCALES = {
  spo2: { lo: 80, hi: 100, zones: (T) => [[80, T.spo2, 'crit'], [T.spo2, T.spo2A, 'warn'], [T.spo2A, 100, 'ok']] },
  tmp: { lo: 35, hi: 42, zones: (T) => [[35, T.tmpA, 'ok'], [T.tmpA, T.tmp, 'warn'], [T.tmp, 42, 'crit']] },
  pasLo: { lo: 60, hi: 220, zones: (T) => [[60, T.pasLo, 'crit'], [T.pasLo, T.pasA, 'ok'], [T.pasA, 220, 'warn']] },
  fcHi: { lo: 30, hi: 170, zones: (T) => [[30, 40, 'crit'], [40, T.fcA, 'ok'], [T.fcA, T.fcHi, 'warn'], [T.fcHi, 170, 'crit']] },
  frHi: { lo: 4, hi: 44, zones: (T) => [[4, 8, 'crit'], [8, T.frA, 'ok'], [T.frA, T.frHi, 'warn'], [T.frHi, 44, 'crit']] },
};

function Scale({ k, T }) {
  const { lo, hi, zones } = SCALES[k];
  const pos = (v) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;
  const zs = zones(T).filter(([a, b]) => b > a);
  const ticks = [...new Set(zs.flatMap(([a, b]) => [a, b]).filter((v) => v > lo && v < hi))];
  return (
    <div className="th-scale" aria-hidden="true">
      {zs.map(([a, b, kind]) => <i key={`${a}-${kind}`} className={`zone ${kind}`} style={{ left: pos(a), width: `calc(${pos(b)} - ${pos(a)} - 2px)` }} />)}
      {ticks.map((v) => <span key={v} className="tick" style={{ left: pos(v) }}>{v}</span>)}
    </div>
  );
}

export default function Umbrales() {
  const { db, run } = useStore();
  const cur = currentThresholds(db);
  const hist = [...db.thresholds].sort((a, b) => b.since - a.since); // historial completo, la vigente primero
  const [v, setV] = useState(() => Object.fromEntries(Object.entries(cur).map(([k, x]) => [k, String(x)])));
  const medicos = db.users.filter((x) => x.role === 'med' && x.on);
  const [by, setBy] = useState(() => (medicos.some((m) => m.n === hist[0]?.by) ? hist[0].by : ''));
  const nums = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, +x]));
  const errs = validateThresholds(nums);
  const dirty = Object.keys(cur).some((k) => +v[k] !== cur[k]);

  return (
    <>
      <WorkspaceHeader
        title="Umbrales clínicos"
        icon="knobs"
        lead="Valores con los que el sistema asigna la prioridad de triaje (RF-08). Cada cambio necesita la aprobación de un médico y deja una versión en el historial."
      />
      <div className="grid-2 side-r">
        <Panel title="Versión de trabajo" sub="Las zonas se actualizan mientras edita">
          <Msg tone="warn">Los valores deben ser definidos y aprobados por el responsable clínico. Los de este prototipo son de demostración.</Msg>
          <form onSubmit={(e) => { e.preventDefault(); run(saveThresholds, nums, by); }} noValidate className="stack">
            <div>
              {TH_FIELDS.map(([c, a, label, rule, step]) => (
                <div className="th-row" key={c}>
                  <div className="lbl"><b>{label}</b><small>{rule}</small></div>
                  <Field label="Crítico">{(p) => <input {...p} type="number" step={step} aria-label={`${label} crítico`} value={v[c]} onChange={(e) => setV((x) => ({ ...x, [c]: e.target.value }))} />}</Field>
                  <Field label="Alerta">{(p) => <input {...p} type="number" step={step} aria-label={`${label} alerta`} value={v[a]} onChange={(e) => setV((x) => ({ ...x, [a]: e.target.value }))} />}</Field>
                  <Scale k={c} T={nums} />
                </div>
              ))}
            </div>
            <ul className="legend" aria-hidden="true">
              <li><i className="rect" style={{ background: 'var(--good)' }} />Normal</li>
              <li><i className="rect" style={{ background: 'var(--warn)' }} />Alerta: prioridad PRIORITARIA</li>
              <li><i className="rect" style={{ background: 'var(--crit)' }} />Crítico: prioridad CRÍTICA</li>
            </ul>
            {errs.length > 0 && <Msg tone="crit">{errs.map((e) => <div key={e}>{e}</div>)}</Msg>}
            <Field label="Aprobado por (médico responsable)">
              {(a) => (
                <select {...a} value={by} onChange={(e) => setBy(e.target.value)}>
                  <option value="">Seleccione un médico…</option>
                  {medicos.map((m) => <option key={m.u} value={m.n}>{m.n}, {m.col}</option>)}
                </select>
              )}
            </Field>
            <div className="actions">
              <button className="btn" disabled={!!errs.length || !dirty || !by.trim()}><Save /> Guardar y registrar aprobación</button>
              {!dirty && <span className="note">Sin cambios respecto a la versión vigente.</span>}
            </div>
          </form>
        </Panel>
        <Panel title="Historial de versiones" count={hist.length}>
          <ol className="versions">
            {hist.map((h, i) => (
              <li key={h.id} className={i === 0 ? 'on' : ''}>
                <i className="vdot" aria-hidden="true" />
                <div>
                  <b>Desde el {fmtD(h.since)}</b>
                  <small>Aprobó: {h.by}</small>
                  <small>SpO₂ &lt; {h.vals.spo2}, T ≥ {h.vals.tmp}, PAS &lt; {h.vals.pasLo}, FC &gt; {h.vals.fcHi}, FR &gt; {h.vals.frHi}</small>
                </div>
                <Badge tone={i === 0 ? 'ok' : 'mut'}>{i === 0 ? 'Vigente' : 'Anterior'}</Badge>
              </li>
            ))}
          </ol>
          <p className="note">Cada cambio cierra la vigencia anterior y queda registrado en la auditoría.</p>
        </Panel>
      </div>
    </>
  );
}
