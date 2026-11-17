import { useSyncExternalStore } from 'react';

/**
 * Preferencia de animaciones de este equipo. Sin elección, sigue al sistema operativo: si Windows o macOS
 * piden «reducir movimiento», las animaciones se apagan (accesibilidad). El botón de la barra superior y del
 * inicio de sesión la fija en «completo» o «reducido», y se recuerda.
 *
 * Se aplica como data-motion en <html> (styles/motion.css) y como reducedMotion de Motion (main.jsx).
 */
const KEY = 'sgc-motion';
const MEDIA = '(prefers-reduced-motion: reduce)';
const oyentes = new Set();

const leer = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'completo' || v === 'reducido' ? v : null;
  } catch {
    return null;
  }
};
const sistemaReduce = () => !!window.matchMedia?.(MEDIA).matches;
const aplicar = (pref) => {
  const root = document.documentElement;
  if (pref) root.dataset.motion = pref;
  else delete root.dataset.motion;
};

let pref = typeof window === 'undefined' ? null : leer();

/** Aplica la preferencia guardada antes de dibujar la app. */
export const applyStoredMotion = () => aplicar(pref);

/** ¿Hay que reducir el movimiento ahora? (la elección del usuario manda sobre la del sistema) */
export const movimientoReducido = () => (pref ? pref === 'reducido' : sistemaReduce());

function cambiar(next) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* sin almacenamiento: dura hasta recargar */
  }
  aplicar(next);
  oyentes.forEach((cb) => cb());
}

const suscribir = (cb) => {
  oyentes.add(cb);
  const mq = window.matchMedia?.(MEDIA);
  mq?.addEventListener?.('change', cb);
  return () => {
    oyentes.delete(cb);
    mq?.removeEventListener?.('change', cb);
  };
};
const foto = () => `${pref ?? ''}|${sistemaReduce()}`;

/**
 * { reducido, pref, alternar, motionConfig }: `reducido` es el estado efectivo; `alternar` pasa de uno al otro;
 * `motionConfig` es el valor para <MotionConfig reducedMotion>.
 */
export function useMovimiento() {
  useSyncExternalStore(suscribir, foto, () => '|false');
  const reducido = movimientoReducido();
  return {
    reducido,
    pref,
    alternar: () => cambiar(reducido ? 'completo' : 'reducido'),
    motionConfig: pref === 'completo' ? 'never' : pref === 'reducido' ? 'always' : 'user',
  };
}
