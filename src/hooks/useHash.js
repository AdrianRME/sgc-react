import { useEffect, useState } from 'react';

/** Dirección actual (#/rol/sección) como partes: «#/jefatura/usuarios» → { route: 'jefatura', sub: 'usuarios' }. */
export function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const [, route = '', sub = ''] = hash.split('/');
  return { hash, route, sub };
}

export const go = (path) => {
  window.location.hash = path;
};
