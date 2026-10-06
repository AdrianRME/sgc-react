import { CircleCheck, TriangleAlert } from 'lucide-react';

/** Severidad del cumplimiento: el color va siempre con ícono y texto. */
const level = (rate) => (rate == null ? null : rate >= 0.9 ? ['good', 'Cumple', CircleCheck] : rate >= 0.75 ? ['warn', 'Por debajo', TriangleAlert] : ['crit', 'Crítico', TriangleAlert]);

/** Medidor de porcentaje frente a una meta. La pista es un tono claro del mismo color del relleno. */
export function Meter({ label, sub, rate, detail }) {
  const lv = level(rate);
  const Icon = lv?.[2];
  return (
    <div className={`meter ${lv ? lv[0] : ''}`}>
      <div className="meter-h">
        <span className="meter-l">{label}{sub && <small>{sub}</small>}</span>
        <b>{rate == null ? '—' : `${Math.round(rate * 100)} %`}</b>
      </div>
      <div className="meter-t" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate == null ? undefined : Math.round(rate * 100)} aria-label={label}>
        <i style={{ width: `${(rate || 0) * 100}%` }} />
      </div>
      <span className="meter-s">{lv && <><Icon aria-hidden="true" />{lv[1]}</>}{detail && <span>{detail}</span>}</span>
    </div>
  );
}
