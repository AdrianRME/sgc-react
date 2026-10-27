import { m } from 'motion/react';
import { listItem } from '../lib/motion.js';
import { fullName, iniciales } from '../lib/format.js';
import { TurnCode } from './ui.jsx';

/**
 * Tarjeta de un paciente en una cola: iniciales, nombre, turno y datos breves a la izquierda; su estado y la
 * acción principal a la derecha. `c` es el color del borde (estación o prioridad); `on` la marca como actual;
 * `note` es una línea de texto libre (el motivo de consulta, por ejemplo).
 */
export function PacCard({ turn, patient, c, tag, meta, note, badge, actions, on = false }) {
  return (
    <m.li {...listItem} layout className={`pac ${on ? 'on' : ''}`} style={{ '--c': c }}>
      <span className="pac-av" aria-hidden="true">{patient ? iniciales(patient) : '?'}</span>
      <div className="pac-main">
        <b>{fullName(patient)}</b>
        <span className="pac-meta">
          <TurnCode id={turn.id} />
          {tag && <span className="pac-st">{tag}</span>}
          {meta}
        </span>
        {note && <span className="pac-note">{note}</span>}
      </div>
      {badge ?? <span />}
      <div className="pac-acts">{actions}</div>
    </m.li>
  );
}

/**
 * Bloque grande «qué toca ahora»: el paciente que sigue y el botón para llamarlo. Se muestra cuando no hay
 * nadie en atención, para que el siguiente paso quede a la vista.
 */
export function Siguiente({ kicker = 'Siguiente paciente', turn, patient, c, detail, action }) {
  return (
    <div className="next-up" style={{ '--c': c }}>
      <span className="pac-av" aria-hidden="true">{patient ? iniciales(patient) : '?'}</span>
      <div className="next-main">
        <small>{kicker}</small>
        <b>{fullName(patient)}</b>
        <span className="pac-meta"><TurnCode id={turn.id} />{detail}</span>
      </div>
      <div className="next-act">{action}</div>
    </div>
  );
}
