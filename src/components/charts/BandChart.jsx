import { useState } from 'react';
import { niceTicks, linear, topRoundedRect, labelEvery } from './scale.js';
import { useWidth } from './useSize.js';
import { ChartTooltip, Legend } from './Tooltip.jsx';

const M = { top: 14, bottom: 28, left: 40 };
const BAR_MAX = 24;
const GAP = 2;

/**
 * Marco común de los gráficos por categoría (días u horas): escala, rejilla, ejes,
 * posición activa con mouse o teclado (← →) y tooltip con todas las series en esa posición.
 */
function useBand({ data, max, height, rightPad }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);
  const plotW = Math.max(40, width - M.left - rightPad);
  const plotH = height - M.top - M.bottom;
  const band = plotW / Math.max(1, data.length);
  const ticks = niceTicks(max);
  const y = linear(0, ticks[ticks.length - 1], M.top + plotH, M.top);
  const cx = (i) => M.left + band * i + band / 2;
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - M.left) / band);
    setActive(i >= 0 && i < data.length ? i : null);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(data.length - 1, (a ?? -1) + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(0, (a ?? data.length) - 1)); }
    if (e.key === 'Escape') setActive(null);
  };
  return [ref, { width, plotW, plotH, band, ticks, y, cx, active, setActive, pick, onKey }];
}

function Axes({ b, data, format }) {
  const every = labelEvery(data.length, b.plotW);
  return (
    <g className="axes" aria-hidden="true">
      {b.ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={M.left + b.plotW} y1={b.y(t)} y2={b.y(t)} className={t === 0 ? 'base' : 'grid'} />
          <text x={M.left - 8} y={b.y(t)} dy="0.32em" textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (data.length - 1 - i >= every || i === data.length - 1) && (
        <text key={d.label} x={b.cx(i)} y={M.top + b.plotH + 18} textAnchor="middle">{d.label}</text>
      ))}
    </g>
  );
}

function Frame({ b, boxRef, height, ariaLabel, children, tip }) {
  return (
    <div className="chart" ref={boxRef}>
      <svg
        width={b.width}
        height={height}
        role="group"
        tabIndex={0}
        aria-label={`${ariaLabel}. Use las flechas izquierda y derecha para recorrer los valores.`}
        onPointerMove={b.pick}
        onPointerLeave={() => b.setActive(null)}
        onKeyDown={b.onKey}
        onBlur={() => b.setActive(null)}
      >
        {children}
      </svg>
      {tip}
    </div>
  );
}

/** Columnas apiladas (p. ej., atenciones por día según prioridad). */
export function ColumnChart({ data, series, height = 240, format = (v) => v, ariaLabel }) {
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.k] || 0), 0));
  const [boxRef, b] = useBand({ data, max: Math.max(1, ...totals), height, rightPad: 8 });
  const w = Math.max(4, Math.min(BAR_MAX, b.band * 0.62));
  const a = b.active;
  const best = totals.indexOf(Math.max(...totals));
  return (
    <figure className="fig-chart">
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <Frame
        b={b}
        boxRef={boxRef}
        height={height}
        ariaLabel={ariaLabel}
        tip={a != null && (
          <ChartTooltip
            x={b.cx(a)}
            y={b.y(totals[a])}
            width={b.width}
            title={data[a].title || data[a].label}
            rows={[...series].reverse().map((s) => ({ label: s.label, value: format(data[a].values[s.k] || 0), color: s.color }))
              .concat({ label: 'Total', value: format(totals[a]) })}
          />
        )}
      >
        <Axes b={b} data={data} format={format} />
        {a != null && <rect className="hover-band" x={b.cx(a) - b.band / 2} y={M.top} width={b.band} height={b.plotH} />}
        {data.map((d, i) => {
          let base = b.y(0);
          const visible = series.filter((s) => d.values[s.k] > 0);
          return (
            <g key={d.label} className={a != null && a !== i ? 'dim' : ''}>
              {visible.map((s, j) => {
                const top = b.y(0) - (b.y(0) - b.y(d.values[s.k])) - (b.y(0) - base);
                const h = base - top - (j > 0 ? GAP : 0);
                const x = b.cx(i) - w / 2;
                const isTop = j === visible.length - 1;
                const el = isTop
                  ? <path key={s.k} d={topRoundedRect(x, top, w, Math.max(0, h))} fill={s.color} />
                  : <rect key={s.k} x={x} y={top} width={w} height={Math.max(0, h)} fill={s.color} />;
                base = top;
                return el;
              })}
            </g>
          );
        })}
        {totals[best] > 0 && (
          <text className="cap" x={b.cx(best)} y={b.y(totals[best]) - 6} textAnchor="middle">{format(totals[best])}</text>
        )}
      </Frame>
    </figure>
  );
}

/** Líneas con cruz de lectura (p. ej., minutos de espera por día). Los huecos (sin dato) cortan la línea. */
export function LineChart({ data, series, height = 240, format = (v) => v, ariaLabel, unit = '' }) {
  const all = data.flatMap((d) => series.map((s) => d.values[s.k])).filter((v) => v != null);
  const [boxRef, b] = useBand({ data, max: Math.max(1, ...all), height, rightPad: series.length > 1 ? 112 : 16 });
  const a = b.active;
  const path = (k) => data.reduce((acc, d, i) => {
    const v = d.values[k];
    if (v == null) return { d: acc.d, open: false };
    return { d: `${acc.d}${acc.open ? 'L' : 'M'}${b.cx(i).toFixed(1)},${b.y(v).toFixed(1)}`, open: true };
  }, { d: '', open: false }).d;
  const ends = series.map((s) => {
    const i = data.map((d) => d.values[s.k]).findLastIndex((v) => v != null);
    return { s, i, v: i >= 0 ? data[i].values[s.k] : null };
  });
  // Etiquetas al final solo si no se pisan; si no, quedan la leyenda y el tooltip
  const ys = ends.filter((e) => e.v != null).map((e) => b.y(e.v)).sort((p, q) => p - q);
  const endLabels = series.length > 1 && ys.every((v, i) => i === 0 || v - ys[i - 1] >= 14);
  return (
    <figure className="fig-chart">
      {series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} shape="line" />}
      <Frame
        b={b}
        boxRef={boxRef}
        height={height}
        ariaLabel={ariaLabel}
        tip={a != null && (
          <ChartTooltip
            x={b.cx(a)}
            y={Math.min(...series.map((s) => (data[a].values[s.k] != null ? b.y(data[a].values[s.k]) : b.y(0))))}
            width={b.width}
            title={data[a].title || data[a].label}
            rows={series.map((s) => ({ label: s.label, value: data[a].values[s.k] != null ? `${format(data[a].values[s.k])}${unit}` : 'sin datos', color: s.color }))}
          />
        )}
      >
        <Axes b={b} data={data} format={format} />
        {a != null && <line className="crosshair" x1={b.cx(a)} x2={b.cx(a)} y1={M.top} y2={M.top + b.plotH} />}
        {series.map((s) => (
          <path key={s.k} d={path(s.k)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => data.map((d, i) => d.values[s.k] != null && (i === a || ends.find((e) => e.s === s)?.i === i) && (
          <circle key={`${s.k}-${i}`} cx={b.cx(i)} cy={b.y(d.values[s.k])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
        )))}
        {endLabels && ends.filter((e) => e.v != null).map((e) => (
          <g key={e.s.k} className="end-label">
            <line x1={b.cx(e.i) + 8} x2={b.cx(e.i) + 18} y1={b.y(e.v)} y2={b.y(e.v)} stroke={e.s.color} strokeWidth="2" />
            <text x={b.cx(e.i) + 22} y={b.y(e.v)} dy="0.32em">{format(e.v)}{unit} {e.s.short || ''}</text>
          </g>
        ))}
      </Frame>
    </figure>
  );
}
