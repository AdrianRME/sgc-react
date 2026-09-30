import { useEffect, useState } from 'react';

/** Devuelve la hora actual y se actualiza cada `ms` (para tiempos de espera y reloj). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
