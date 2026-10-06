import { useEffect, useId, useRef } from 'react';
import { animate, m, useReducedMotion } from 'motion/react';
import { CircleCheck, ChevronsUp, Clock, Info, TriangleAlert } from 'lucide-react';
import { STATE, PRIO, SIS, ROUTE } from '../lib/constants.js';
import { waitInfo } from '../lib/clinical.js';
import { fmtNum, initials } from '../lib/format.js';
import { spring } from '../lib/motion.js';
import { Icon3D } from './Icon3D.jsx';

/* ---------- Etiquetas ---------- */

export const Badge = ({ tone = 'mut', icon: Icon, children, title }) => (
  <span className={`badge b-${tone}`} title={title}>
    {Icon && <Icon aria-hidden="true" />}
    {children}
  </span>
);

export const StateBadge = ({ state }) => <Badge tone={STATE[state][1]}>{STATE[state][0]}</Badge>;

/** La prioridad nunca depende solo del color: lleva ícono y texto. */
const PRIO_ICON = { CRITICA: TriangleAlert, PRIORITARIA: ChevronsUp, NORMAL: CircleCheck };
export const PrioBadge = ({ prio }) =>
  prio ? <Badge tone={PRIO[prio][1]} icon={PRIO_ICON[prio]}>{PRIO[prio][0]}</Badge> : <Badge>Sin triaje</Badge>;

export const SisBadge = ({ sis }) => <Badge tone={SIS[sis]?.[1] || 'mut'}>{SIS[sis]?.[0] || sis}</Badge>;

export const TurnCode = ({ id, className = '' }) => <span className={`tcode ${className}`}>{id}</span>;

/* ---------- Contenedores ---------- */

export function Panel({ title, sub, icon, count, actions, children, className = '', ...rest }) {
  return (
    <section className={`panel ${className}`} {...rest}>
      {(title || actions) && (
        <header className="panel-h">
          {icon && <Icon3D name={icon} size={30} />}
          <div className="titles">
            {title && <h2>{title}{count != null && <span className="count">{count}</span>}</h2>}
            {sub && <span className="sub">{sub}</span>}
          </div>
          {actions && <div className="panel-a">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export const Empty = ({ icon = 'sparkles', title, children }) => (
  <div className="empty">
    <Icon3D name={icon} size={56} />
    {title && <b>{title}</b>}
    {children && <span>{children}</span>}
  </div>
);

const MSG_ICON = { crit: TriangleAlert, warn: TriangleAlert, ok: CircleCheck, info: Info };
export const Msg = ({ tone = 'info', children, role }) => {
  const Icon = MSG_ICON[tone];
  return (
    <div className={`msg ${tone}`} role={role || (tone === 'crit' ? 'alert' : 'status')}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
};

/** Campo con etiqueta, error y descripción accesibles. */
export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function'
    ? children({ id, 'aria-invalid': !!error, 'aria-describedby': error || hint ? `${id}-d` : undefined })
    : children;
  return (
    <div className={`field ${error ? 'has-err' : ''} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {child}
      {(error || hint) && <small id={`${id}-d`} className={error ? 'err' : 'hint'}>{error || hint}</small>}
    </div>
  );
}

/* ---------- Tiempo y ruta ---------- */

/** Minutos de espera, en rojo con ícono si supera el tiempo objetivo de su prioridad. */
export function WaitTime({ turn, now }) {
  const w = waitInfo(turn, now);
  return (
    <span className={`wait ${w.late ? 'late' : ''}`} title={`Objetivo: ${w.target} min`}>
      {w.late ? <TriangleAlert aria-hidden="true" /> : <Clock aria-hidden="true" />}
      {w.min} min{w.late && <span className="sr-only"> (supera el objetivo de {w.target} min)</span>}
    </span>
  );
}

/** Recorrido del paciente en miniatura: Admisión → Triaje → Consulta → Alta. */
export function MiniRoute({ state }) {
  const cur = ROUTE.findIndex((s) => s.states.includes(state));
  return (
    <ol className="mroute" aria-label={`Etapa: ${ROUTE[cur]?.n ?? 'Admisión'}`}>
      {ROUTE.map((s, i) => (
        <li
          key={s.k}
          title={s.n}
          className={i < cur ? 'done' : i === cur ? 'now' : ''}
          style={{ '--c': `var(--st-${s.k === 'alta' ? 'jef' : s.k})` }}
        />
      ))}
    </ol>
  );
}

/* ---------- Controles ---------- */

/** Control segmentado con indicador animado. options: [[valor, etiqueta, contador?]]. */
export function Segmented({ value, onChange, options, label }) {
  const id = useId();
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, l, n]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {value === k && <m.i className="thumb" layoutId={`seg-${id}`} transition={spring} />}
          <span>{l}{n != null && <span className="n">{n}</span>}</span>
        </button>
      ))}
    </div>
  );
}

/** Pestañas con subrayado animado. items: [[valor, etiqueta]]. */
export function Tabs({ value, onChange, items, label }) {
  const id = useId();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([k, l]) => (
        <button key={k} role="tab" className="tab" aria-selected={value === k} onClick={() => onChange(k)}>
          {l}
          {value === k && <m.i className="bar" layoutId={`tab-${id}`} transition={spring} />}
        </button>
      ))}
    </div>
  );
}

export const Avatar = ({ name, title }) => <span className="avatar" title={title || name} aria-hidden="true">{initials(name)}</span>;
export const Kbd = ({ children }) => <kbd className="kbd">{children}</kbd>;

/**
 * Número que se anima cuando cambia su valor (o desde cero, con `fromZero`, al aparecer).
 * Los valores no numéricos se muestran tal cual.
 */
export function AnimatedNumber({ value, format = (v) => fmtNum(Math.round(v)), fromZero = false }) {
  const ref = useRef(null);
  const prev = useRef(fromZero ? 0 : value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof value !== 'number' || reduce || typeof prev.current !== 'number') {
      el.textContent = typeof value === 'number' ? format(value) : value ?? '—';
      prev.current = value;
      return undefined;
    }
    const ctl = animate(prev.current, value, { duration: 0.7, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => { el.textContent = format(v); } });
    prev.current = value;
    return () => ctl.stop();
  }, [value, format, reduce]);
  return <span ref={ref}>{typeof value === 'number' ? format(fromZero ? 0 : value) : value ?? '—'}</span>;
}
