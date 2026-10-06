import { useEffect, useRef } from 'react';

/** Atajo de teclado global. `match(e)` decide si el evento corresponde; se ignora mientras se escribe, salvo con Ctrl/⌘. */
export function useHotkey(match, handler) {
  const ref = useRef({ match, handler });
  useEffect(() => {
    ref.current = { match, handler };
  });
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (typing && !(e.ctrlKey || e.metaKey)) return;
      if (ref.current.match(e)) {
        e.preventDefault();
        ref.current.handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
