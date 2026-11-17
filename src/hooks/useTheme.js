import { useCallback, useEffect, useState } from 'react';

const KEY = 'sgc-theme';
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const apply = (theme) => {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
};

/** Aplica el tema guardado en este equipo antes de dibujar la app (evita el parpadeo). */
export const applyStoredTheme = () => apply(read());

/** Tema claro u oscuro elegido en este equipo; sin elección, sigue al sistema operativo. */
export function useTheme() {
  const [theme, setThemeState] = useState(read);
  useEffect(() => apply(theme), [theme]);
  const effective = theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  /**
   * Cambia el tema. Si el navegador lo permite, el tema nuevo se abre como un círculo que crece desde donde se
   * pulsó (View Transitions; la animación «revela» está en styles/motion.css). `e` es el clic, si lo hubo.
   */
  const toggle = useCallback((e) => {
    const next = effective === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* sin almacenamiento: el tema dura hasta recargar */
    }
    const cambiar = () => {
      apply(next); // de inmediato, para que la transición capture ya el tema nuevo
      setThemeState(next);
    };
    const quieto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || quieto || document.hidden) {
      cambiar();
      return;
    }
    const root = document.documentElement;
    root.style.setProperty('--vt-x', `${e?.clientX ?? window.innerWidth - 90}px`);
    root.style.setProperty('--vt-y', `${e?.clientY ?? 28}px`);
    // Si la transición se interrumpe (pestaña en segundo plano), el tema ya cambió: no hay nada que avisar
    document.startViewTransition(cambiar).ready.catch(() => {});
  }, [effective]);
  return { theme, effective, toggle };
}
