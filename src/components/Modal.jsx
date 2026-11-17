import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'motion/react';
import { X } from 'lucide-react';
import { fade, pop } from '../lib/motion.js';
import { Field } from './ui.jsx';
import { Icono } from './Icono.jsx';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible: atrapa el foco, cierra con Escape o clic fuera y devuelve el foco al salir.
 * Para animar la salida, el padre lo envuelve en <AnimatePresence>.
 *
 * Se dibuja directamente en <body>, fuera del marco de la app: así, al imprimir un documento (ticket, receta,
 * boleta), se oculta todo lo demás y sale solo el documento. Conserva el color de la estación desde la que se
 * abrió (data-role del ancestro más cercano).
 */
export function Modal({ label, onClose, children, size = 'md', className = '', dismissible = true }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = dismissible ? onClose : () => {};
  }, [onClose, dismissible]);
  useEffect(() => {
    const prev = document.activeElement;
    const box = ref.current;
    (box.querySelector('[autofocus], input, select, textarea') || box.querySelector(FOCUSABLE))?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  // El color de la estación lo toma del lugar donde se abrió, antes de pintarse (sin parpadeo)
  const ancla = useRef(null);
  const [rol, setRol] = useState(undefined);
  useLayoutEffect(() => {
    setRol(ancla.current?.closest('[data-role]')?.dataset.role);
  }, []);
  return (
    <>
      <span ref={ancla} hidden />
      {createPortal(
    <m.div className="overlay" data-role={rol} {...fade} onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <m.div {...pop} className={`dialog ${size} ${className}`} role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {dismissible && (
          <button className="icon-btn sm dialog-x no-print" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        )}
        {children}
      </m.div>
    </m.div>,
        document.body,
      )}
    </>
  );
}

/** Confirmación para acciones que no se pueden deshacer. `options` muestra un selector de motivo. */
export function ConfirmDialog({ title, text, icon = 'warning', confirmLabel = 'Confirmar', danger, options, onConfirm, onCancel }) {
  const [opt, setOpt] = useState(options?.[0] || '');
  return (
    <Modal label={title} onClose={onCancel} size="sm">
      <Icono name={icon} size={48} className="head-icon" />
      <h3>{title}</h3>
      <p>{text}</p>
      {options && (
        <Field label="Motivo">
          {(p) => (
            <select {...p} value={opt} onChange={(e) => setOpt(e.target.value)}>
              {options.map((o) => <option key={o}>{o}</option>)}
            </select>
          )}
        </Field>
      )}
      <div className="actions end">
        <button className="btn sec" onClick={onCancel}>Volver</button>
        <button className={`btn ${danger ? 'dng-solid' : ''}`} onClick={() => onConfirm(opt)}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
