import { useSyncExternalStore } from 'react';

/** Caso que se está reproduciendo en vivo (o null). Lo abre el simulador y lo muestra App en lugar de la app real. */
let actual = null;
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f());

export const iniciarVivo = (k) => {
  actual = k;
  avisar();
};
export const detenerVivo = () => {
  actual = null;
  avisar();
};
export const useSimVivo = () =>
  useSyncExternalStore((f) => {
    oyentes.add(f);
    return () => oyentes.delete(f);
  }, () => actual);
