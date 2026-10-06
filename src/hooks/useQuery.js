import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Consulta asíncrona que conserva el último resultado mientras recarga (sin parpadeos):
 * `loading` es verdadero mientras la respuesta no corresponde a la `key` actual, y `data`
 * sigue mostrando lo anterior. Cuando `key` cambia, se vuelve a pedir.
 */
export function useQuery(fn, key) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const want = `${key}#${nonce}`;
  useEffect(() => {
    let alive = true;
    fnRef.current().then(
      (data) => alive && setState({ key: want, data, error: null }),
      (e) => alive && setState((s) => ({ ...s, key: want, error: e.message || String(e) })),
    );
    return () => {
      alive = false;
    };
  }, [want]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.key !== want, reload };
}
