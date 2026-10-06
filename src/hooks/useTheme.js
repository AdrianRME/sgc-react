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
  const toggle = useCallback(() => {
    const next = effective === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* sin almacenamiento: el tema dura hasta recargar */
    }
    setThemeState(next);
  }, [effective]);
  return { theme, effective, toggle };
}
