import { useEffect, useState } from 'react';
import { EVENTO_RELOJ } from '../lib/reloj.js';

/** Devuelve la hora actual y se actualiza cada `ms` (para tiempos de espera y reloj) o cuando la simulación mueve el reloj. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, ms);
    window.addEventListener(EVENTO_RELOJ, tick);
    return () => {
      clearInterval(id);
      window.removeEventListener(EVENTO_RELOJ, tick);
    };
  }, [ms]);
  return now;
}
