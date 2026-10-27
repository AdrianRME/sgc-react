import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { CircleHelp } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { GUIDE, ROLES } from '../lib/constants.js';
import { pop } from '../lib/motion.js';
import { SectionHero } from './SectionHero.jsx';
import { useDismiss } from '../hooks/useDismiss.js';

/** Botón «Cómo trabajar aquí»: los pasos de trabajo del rol, en orden. */
export function Help({ role }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  return (
    <div className="help" ref={ref}>
      <button className="btn sec sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CircleHelp /> Cómo trabajar aquí
      </button>
      <AnimatePresence>
        {open && (
          <m.div {...pop} className="popover help-pop" role="dialog" aria-label="Pasos de trabajo">
            <b>Pasos de trabajo</b>
            <ol>{GUIDE[role].steps.map((s) => <li key={s}>{s}</li>)}</ol>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Encabezado de las secciones de apoyo (historias, usuarios, horarios, auditoría, umbrales): el mismo encabezado
 * de color que las estaciones de la ruta, con el área como antetítulo y la ayuda del rol.
 */
export function WorkspaceHeader({ title, icon, lead, tiles }) {
  const { user } = useStore();
  const role = ROLES[user.role];
  return (
    <SectionHero
      icon={icon || role.icon}
      kicker={role.space}
      title={title}
      text={lead || GUIDE[user.role].lead}
      tiles={tiles}
      actions={<Help role={user.role} />}
    />
  );
}
