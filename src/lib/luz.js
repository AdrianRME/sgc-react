/**
 * Luz que sigue al cursor sobre las tarjetas (styles/interaccion.css). Un solo oyente para toda la página:
 * con el ratón sobre una tarjeta, le pone --mx y --my (la posición del cursor dentro de ella) una vez por
 * cuadro. No hace nada en pantallas táctiles ni con movimiento reducido.
 */
import { movimientoReducido } from '../hooks/useMovimiento.js';

const TARJETAS = '.pac, .cita-card, .kpi, .dash-tab, .hero-kpi, .room, .card, .esp-pill, .cw-esp';

export function activarLuz() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return () => {};
  let pendiente = null;
  let ultima = null;
  const pintar = () => {
    const { el, x, y } = pendiente;
    pendiente = null;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${x - r.left}px`);
    el.style.setProperty('--my', `${y - r.top}px`);
  };
  const mover = (e) => {
    if (e.pointerType !== 'mouse' || movimientoReducido()) return;
    const el = e.target.closest?.(TARJETAS);
    if (ultima && ultima !== el) {
      ultima.style.removeProperty('--mx');
      ultima.style.removeProperty('--my');
    }
    ultima = el;
    if (!el) return;
    if (!pendiente) requestAnimationFrame(pintar);
    pendiente = { el, x: e.clientX, y: e.clientY };
  };
  document.addEventListener('pointermove', mover, { passive: true });
  return () => document.removeEventListener('pointermove', mover);
}
