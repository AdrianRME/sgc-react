/**
 * Tooltip de gráfico: el valor primero (fuerte) y la serie después, con una línea corta de su color.
 * Se posiciona dentro del contenedor del gráfico y cambia de lado cerca del borde derecho.
 */
export function ChartTooltip({ x, y, width, title, rows }) {
  if (x == null) return null;
  const right = x > width - 200;
  return (
    <div className="ctip" style={{ left: right ? undefined : x + 14, right: right ? width - x + 14 : undefined, top: Math.max(0, y - 10) }} role="status">
      {title && <div className="ctip-t">{title}</div>}
      {rows.map((r) => (
        <div className="ctip-r" key={r.label}>
          {r.color && <i style={{ background: r.color }} aria-hidden="true" />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Leyenda: siempre presente con dos o más series. `shape` imita la marca (barra o línea). */
export function Legend({ items, shape = 'rect' }) {
  return (
    <ul className="legend">
      {items.map((s) => (
        <li key={s.label}>
          <i className={shape} style={{ background: s.color }} aria-hidden="true" />
          {s.label}
          {s.value != null && <b>{s.value}</b>}
        </li>
      ))}
    </ul>
  );
}
