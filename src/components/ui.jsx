import { useEffect, useId, useRef, useState } from 'react';
import { STATE, PRIO, SIS, FLOW } from '../lib/constants.js';
import { waitInfo } from '../lib/clinical.js';

export const Badge = ({ tone = 'mut', children, title }) => (
  <span className={`badge b-${tone}`} title={title}>{children}</span>
);

export const StateBadge = ({ state }) => <Badge tone={STATE[state][1]}>{STATE[state][0]}</Badge>;

export const PrioBadge = ({ prio }) =>
  prio ? <Badge tone={PRIO[prio][1]}>{PRIO[prio][0]}</Badge> : <Badge tone="mut">Sin triaje</Badge>;

export const SisBadge = ({ sis }) => <Badge tone={SIS[sis]?.[1] || 'mut'}>{SIS[sis]?.[0] || sis}</Badge>;

export const Code = ({ children }) => <span className="code">{children}</span>;

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-h">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-a">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Msg = ({ tone = 'info', children, role }) => (
  <div className={`msg ${tone}`} role={role || (tone === 'crit' ? 'alert' : 'status')}>{children}</div>
);

/** Campo con etiqueta, error y descripción accesibles. */
export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children({ id, 'aria-invalid': !!error, 'aria-describedby': error || hint ? `${id}-d` : undefined }) : children;
  return (
    <div className={`field ${error ? 'has-err' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {child}
      {(error || hint) && <small id={`${id}-d`} className={error ? 'err' : 'hint'}>{error || hint}</small>}
    </div>
  );
}

/** Minutos de espera con color si supera el tiempo objetivo de su prioridad. */
export function WaitTime({ turn, now }) {
  const w = waitInfo(turn, now);
  return (
    <span className={`wait ${w.late ? 'late' : ''}`} title={`Objetivo: ${w.target} min`}>
      {w.late && '⚠ '}
      {w.min} min
    </span>
  );
}

/** Indicador del recorrido del paciente: Admisión → Triaje → Consulta → Alta. */
export function FlowSteps({ state }) {
  const cur = FLOW.findIndex(([, states]) => states.includes(state));
  return (
    <ol className="flow" aria-label="Etapa del paciente">
      {FLOW.map(([name], i) => (
        <li key={name} className={i < cur ? 'done' : i === cur ? 'now' : ''} aria-current={i === cur ? 'step' : undefined}>
          {name}
        </li>
      ))}
    </ol>
  );
}

/** Diálogo modal accesible: cierra con Escape o clic en el fondo, y enfoca su contenido. */
export function Modal({ label, onClose, children, className = '' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button, [href]')?.focus();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`doc ${className}`} role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        {children}
      </div>
    </div>
  );
}

/**
 * Confirmación para acciones que no se pueden deshacer.
 * `options` (opcional) muestra un selector de motivo.
 */
export function ConfirmDialog({ title, text, confirmLabel = 'Confirmar', danger, options, onConfirm, onCancel }) {
  const [opt, setOpt] = useState(options?.[0] || '');
  return (
    <Modal label={title} onClose={onCancel} className="confirm">
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

/** Hook para usar ConfirmDialog de forma declarativa: const [ask, dialog] = useConfirm(). */
export function useConfirm() {
  const [cfg, setCfg] = useState(null);
  const ask = (c) => setCfg(c);
  const dialog = cfg && (
    <ConfirmDialog
      {...cfg}
      onCancel={() => setCfg(null)}
      onConfirm={(v) => {
        setCfg(null);
        cfg.onConfirm(v);
      }}
    />
  );
  return [ask, dialog];
}
