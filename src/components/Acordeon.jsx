import { createContext, useContext, useId, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { plegar } from '../lib/motion.js';
import { AnimatedNumber } from './ui.jsx';

/**
 * Acordeón: para las listas que crecen con el centro (personal, especialidades, consultorios, días de agenda).
 * En vez de una lista que obliga a recorrer toda la pantalla, cada grupo es un renglón que resume su contenido
 * y se abre al pulsarlo.
 *
 *   <Acordeon rotulo="11 especialidades">
 *     <Grupo titulo="Medicina general" sub="3 profesionales · atiende hoy" cuenta={3} color="var(--esp-MG)">…</Grupo>
 *   </Acordeon>
 */
const Orden = createContext(null);

/** Contenedor de grupos. Con `barra`, ofrece «Abrir todo» y «Cerrar todo». `rotulo` describe la lista. */
export function Acordeon({ children, rotulo, barra = true, className = '' }) {
  // Cada pulsación es una orden nueva (n cambia) para que los grupos la obedezcan aunque ya se hayan movido a mano
  const [orden, setOrden] = useState(null);
  const dar = (abrir) => setOrden((o) => ({ abrir, n: (o?.n ?? 0) + 1 }));
  return (
    <div className={`acc ${className}`}>
      {(barra || rotulo) && (
        <div className="acc-bar">
          <span className="rotulo">{rotulo}</span>
          {barra && (
            <>
              <button type="button" className="btn ghost sm" onClick={() => dar(true)}><ChevronsUpDown aria-hidden="true" /> Abrir todo</button>
              <button type="button" className="btn ghost sm" onClick={() => dar(false)}><ChevronsDownUp aria-hidden="true" /> Cerrar todo</button>
            </>
          )}
        </div>
      )}
      <Orden.Provider value={orden}>
        <div className="acc-lista">{children}</div>
      </Orden.Provider>
    </div>
  );
}

/** Rótulo que separa familias de grupos dentro de un acordeón (por ejemplo, la rama de las especialidades). */
export const RotuloGrupo = ({ children }) => <div className="acc-rotulo">{children}</div>;

/**
 * Un grupo plegable. `abierto` es su estado inicial; `forzar` lo mantiene abierto mientras sea verdadero
 * (durante una búsqueda, por ejemplo). `extra` va a la derecha del título (etiquetas de resumen).
 */
export function Grupo({ titulo, sub, cuenta, color, abierto = false, forzar = false, extra, children }) {
  const id = useId();
  const orden = useContext(Orden);
  const [open, setOpen] = useState(abierto);
  // Una orden nueva de «Abrir todo / Cerrar todo» se obedece una sola vez, al llegar
  const [obedecida, setObedecida] = useState(orden?.n);
  if (orden && orden.n !== obedecida) {
    setObedecida(orden.n);
    setOpen(orden.abrir);
  }
  const visible = open || forzar;
  return (
    <section className="grupo" data-abierto={visible || undefined} style={color ? { '--c': color } : undefined}>
      <button type="button" className="grupo-h" aria-expanded={visible} aria-controls={id} onClick={() => setOpen(!visible)} disabled={forzar}>
        <ChevronRight className="grupo-flecha" aria-hidden="true" />
        <span className="grupo-t">
          <b>{titulo}</b>
          {sub && <small>{sub}</small>}
        </span>
        <span className="grupo-x">
          {extra}
          {cuenta != null && <span className="count"><AnimatedNumber value={cuenta} /></span>}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {visible && (
          <m.div key="c" id={id} className="grupo-c" {...plegar}>
            <div>{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}
