/** Tendencia mínima (sin ejes): la línea en tono secundario y el último punto destacado. */
export function Sparkline({ values, width = 96, height = 28, label }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && !Number.isNaN(v));
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const x = (i) => 3 + (i / (values.length - 1)) * (width - 6);
  const y = (v) => height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="3.5" fill="var(--role, var(--st-med))" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
