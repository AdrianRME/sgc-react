import { useEffect, useRef } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { escalaciones, escalacionesPara } from '../lib/supervision.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { Icon3D } from './Icon3D.jsx';

const MAX = 3;

/**
 * Franja de supervisión del espacio: los pacientes sensibles que pasaron su tiempo objetivo y que este rol
 * puede atender. Cada alerta nueva se anuncia una vez con un aviso emergente; la franja sigue a la vista
 * mientras la situación no se resuelva.
 */
export function Supervision({ turns, user, onNueva }) {
  const now = useNow(20_000);
  const lista = escalacionesPara(escalaciones(turns, now), user);
  const vistas = useRef(null);
  useEffect(() => {
    // Al entrar, lo ya atrasado se ve en la franja; el aviso emergente es solo para lo que aparece después
    const nuevas = lista.filter((x) => vistas.current && !vistas.current.has(x.key));
    vistas.current = new Set([...(vistas.current ?? []), ...lista.map((x) => x.key)]);
    nuevas.forEach((x) => onNueva?.(`${x.texto} ${x.accion}`));
  }, [lista, onNueva]);
  if (!lista.length) return null;
  return (
    <section className="superv" role="alert" aria-label="Supervisión de pacientes">
      <header>
        <Icon3D name="warning" size={26} />
        <b>Supervisión: {lista.length} paciente{lista.length > 1 ? 's' : ''} sobre su tiempo objetivo</b>
      </header>
      <ul>
        <AnimatePresence initial={false}>
          {lista.slice(0, MAX).map((x) => (
            <m.li key={x.key} {...listItem} className={x.tone}>
              <span>{x.texto}</span>
              <b>{x.accion}</b>
            </m.li>
          ))}
        </AnimatePresence>
      </ul>
      {lista.length > MAX && <small>y {lista.length - MAX} más en «Flujo en vivo».</small>}
    </section>
  );
}
