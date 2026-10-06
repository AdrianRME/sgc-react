import { useState } from 'react';
import { useWidth } from './useSize.js';
import { ChartTooltip } from './Tooltip.jsx';
import { dowName } from '../../lib/format.js';

const STEPS = 7;
const fmt1 = (v) => v.toLocaleString('es-PE', { maximumFractionDigits: 1 });

/**
 * Mapa de calor día de la semana × hora con la rampa secuencial azul (un solo tono).
 * Cada celda muestra su valor cuando cabe; el tooltip da la lectura completa.
 */
export function Heatmap({ data, ariaLabel }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const left = 40;
  const cellW = Math.max(18, (width - left) / data.hours.length);
  const cellH = 34;
  const step = (v) => (v <= 0 ? 0 : Math.min(STEPS, 1 + Math.floor((v / (data.max || 1)) * (STEPS - 0.001))));
  const showText = cellW >= 34;
  return (
    <figure className="fig-chart">
      <div className="chart" ref={ref}>
        <svg width={width} height={data.dows.length * cellH + 24} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {data.cells.map((row, r) => (
            <g key={data.dows[r]}>
              <text className="axis-t" x={left - 8} y={r * cellH + cellH / 2} dy="0.32em" textAnchor="end">{dowName(data.dows[r], true)}</text>
              {row.map((c, i) => {
                const s = step(c.avg);
                const x = left + i * cellW;
                const y = r * cellH;
                return (
                  <g key={c.h} onPointerEnter={() => setHover({ c, x: x + cellW / 2, y })}>
                    <rect className={`hc s${s} ${hover?.c === c ? 'on' : ''}`} x={x + 1} y={y + 1} width={cellW - 2} height={cellH - 2} rx="4" />
                    {showText && c.avg > 0 && <text className={`hv s${s}`} x={x + cellW / 2} y={y + cellH / 2} dy="0.32em" textAnchor="middle">{fmt1(c.avg)}</text>}
                  </g>
                );
              })}
            </g>
          ))}
          {data.hours.map((h, i) => (
            <text key={h} className="axis-t" x={left + i * cellW + cellW / 2} y={data.dows.length * cellH + 16} textAnchor="middle">{h} h</text>
          ))}
        </svg>
        {hover && (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            width={width}
            title={`${dowName(hover.c.dow)}, de ${hover.c.h} a ${hover.c.h + 1} h`}
            rows={[{ label: 'llegadas por día en promedio', value: fmt1(hover.c.avg) }, { label: 'llegadas en total en el periodo', value: hover.c.n }]}
          />
        )}
      </div>
      <figcaption className="scale-legend" aria-hidden="true">
        <span>Menos</span>
        {Array.from({ length: STEPS }, (_, i) => <i key={i} className={`hc s${i + 1}`} />)}
        <span>Más ({fmt1(data.max)} por hora)</span>
      </figcaption>
    </figure>
  );
}
