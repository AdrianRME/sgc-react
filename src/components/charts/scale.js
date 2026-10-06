/** Escalas y marcas mínimas para los gráficos SVG propios (sin librerías externas). */

export const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

/** Marcas de eje «redondas» (0, 5, 10…) que cubren `max`. */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw);
  const n = Math.ceil(max / step);
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
}

/** Rectángulo con las esquinas de arriba redondeadas (extremo de dato) y la base recta. */
export function topRoundedRect(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Igual, pero redondeado a la derecha (barras horizontales). */
export function rightRoundedRect(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

/** Cada cuántas etiquetas mostrar para que no se pisen. */
export const labelEvery = (n, width, labelW = 44) => Math.max(1, Math.ceil(n / Math.max(1, Math.floor(width / labelW))));
