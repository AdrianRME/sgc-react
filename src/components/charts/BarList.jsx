import { useState } from 'react';

/**
 * Barras horizontales ordenadas (una sola serie, un solo color): la etiqueta a la izquierda y el valor
 * en la punta. rows: [{ k, label, sub?, value, display? }].
 */
export function BarList({ rows, color = 'var(--st-med)', format = (v) => v, total }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li
          key={r.k}
          className={hover && hover !== r.k ? 'dim' : ''}
          onPointerEnter={() => setHover(r.k)}
          onPointerLeave={() => setHover(null)}
          title={total ? `${r.label}: ${format(r.value)} (${Math.round((r.value / total) * 100)} %)` : `${r.label}: ${format(r.value)}`}
        >
          <span className="bl-l">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="bl-t">
            <i style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </span>
          <b className="bl-v">{r.display ?? format(r.value)}</b>
        </li>
      ))}
    </ul>
  );
}
