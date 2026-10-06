import { useState } from 'react';
import { Legend } from './Tooltip.jsx';
import { useWidth } from './useSize.js';

/**
 * Una barra horizontal partida en segmentos (parte de un todo o composición de un recorrido).
 * Cada segmento lleva su valor dentro solo si cabe; la leyenda siempre trae los valores.
 * segments: [{ k, label, value, color, display }]
 */
export function StackBar({ segments, format = (v) => v, height = 30, legend = true, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const [ref, width] = useWidth();
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <figure className="fig-chart">
      <div className="stackbar" ref={ref} style={{ height }} role="img" aria-label={ariaLabel}>
        {visible.map((s, i) => {
          const pct = (s.value / total) * 100;
          const text = s.display ?? format(s.value);
          const fits = (pct / 100) * width > String(text).length * 7.5 + 16; // el texto entra con margen
          return (
            <span
              key={s.k}
              className={`sb-seg ${i === 0 ? 'first' : ''} ${i === visible.length - 1 ? 'last' : ''} ${hover && hover !== s.k ? 'dim' : ''}`}
              style={{ flexGrow: s.value, background: s.color, '--txt': s.ink || '#fff' }}
              onPointerEnter={() => setHover(s.k)}
              onPointerLeave={() => setHover(null)}
              title={`${s.label}: ${text} (${Math.round(pct)} %)`}
            >
              {fits && <em>{text}</em>}
            </span>
          );
        })}
      </div>
      {legend && <Legend items={segments.map((s) => ({ label: s.label, color: s.color, value: s.legendValue ?? s.display ?? format(s.value) }))} />}
    </figure>
  );
}
