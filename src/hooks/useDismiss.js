import { useEffect } from 'react';

/** Cierra un menú o ventana flotante al hacer clic fuera de `ref` o al pulsar Escape. */
export function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && close();
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}
