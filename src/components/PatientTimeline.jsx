import { m } from 'motion/react';
import { Activity, FileText } from 'lucide-react';
import { fmtD, fmtT } from '../lib/format.js';
import { parsePA } from '../lib/clinical.js';
import { listItem } from '../lib/motion.js';
import { Sparkline } from './charts/Sparkline.jsx';
import { Badge, Empty, PrioBadge } from './ui.jsx';
import './documents.css';

/** Tendencias de signos vitales entre visitas (de la más antigua a la más reciente). */
const TRENDS = [
  ['PA sistólica', (t) => parsePA(t.tri.pa)?.sys, 'mmHg'],
  ['SpO₂', (t) => t.tri.spo2, '%'],
  ['Temperatura', (t) => t.tri.t, '°C'],
  ['FC', (t) => t.tri.fc, 'lpm'],
  ['Peso', (t) => t.tri.peso, 'kg'],
];

export function VitalTrends({ visits }) {
  const withTri = visits.filter((t) => t.tri).sort((a, b) => a.t0 - b.t0);
  if (withTri.length < 2) return null;
  return (
    <div className="trends" aria-label="Tendencia de signos vitales">
      {TRENDS.map(([label, get, unit]) => {
        const values = withTri.map(get);
        const last = values[values.length - 1];
        return (
          <div className="trend" key={label}>
            <span>{label}</span>
            <b>{last} <small>{unit}</small></b>
            <Sparkline values={values} label={`${label}: ${values.join(', ')} ${unit}`} />
          </div>
        );
      })}
    </div>
  );
}

/** Línea de tiempo de atenciones. `onRecipe(turn)` abre la receta de una atención. */
export function PatientTimeline({ visits, onRecipe, loading }) {
  if (loading && !visits.length) return <div className="skeleton" style={{ height: 140 }} />;
  if (!visits.length) return <Empty icon="folder" title="Sin atenciones previas">Es la primera vez que se atiende a este paciente.</Empty>;
  return (
    <ol className="timeline">
      {visits.map((t) => (
        <m.li key={`${t.id}-${t.t0}`} {...listItem} layout="position">
          <div className="tl-date">
            <b>{fmtD(t.t0)}</b>
            <span>{fmtT(t.t0)}</span>
          </div>
          <div className="tl-body">
            <div className="tl-head">
              <span className="tcode">{t.id}</span>
              {t.prio && <PrioBadge prio={t.prio} />}
              {t.state === 'CANCELADO' && <Badge tone="warn">{t.cancel?.motivo || 'Cancelado'}</Badge>}
              {t.consult && <Badge tone="info">{t.consult.dest}</Badge>}
            </div>
            {t.tri && (
              <p className="tl-vit">
                <Activity aria-hidden="true" />
                {t.tri.motivo}. PA {t.tri.pa}, FC {t.tri.fc}, T {t.tri.t} °C, SpO₂ {t.tri.spo2} %
              </p>
            )}
            {t.consult && (
              <>
                <ul className="tl-dx">
                  {t.consult.dx.map((d) => (
                    <li key={d[0]}><b className="code">{d[0]}</b> {d[1]} <small>({d[2] === 'D' ? 'definitivo' : 'presuntivo'})</small></li>
                  ))}
                </ul>
                <p className="tl-meds">{t.consult.meds.map((x) => x.n).join(', ') || 'Sin medicación'}</p>
                <div className="tl-foot">
                  <span>{t.consult.medico?.n} en {t.consult.area}</span>
                  {onRecipe && (
                    <button className="btn ghost sm" onClick={() => onRecipe(t)}><FileText /> Receta {t.consult.rec}</button>
                  )}
                </div>
              </>
            )}
          </div>
        </m.li>
      ))}
    </ol>
  );
}
