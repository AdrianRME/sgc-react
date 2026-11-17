import { useEffect, useId, useRef, useState } from 'react';
import { animate, m } from 'motion/react';
import { CircleCheck, ChevronsUp, Clock, Info, TriangleAlert } from 'lucide-react';
import { STATE, PRIO, SIS, ROUTE, ESP_POR_RAMA, PREFERENTE } from '../lib/constants.js';
import { waitInfo } from '../lib/clinical.js';
import { fmtNum, initials } from '../lib/format.js';
import { spring } from '../lib/motion.js';
import { Icono } from './Icono.jsx';
import { useMovimiento } from '../hooks/useMovimiento.js';

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

/** Urgencia y atención preferente de un turno (solo en las estaciones con sesión, nunca en la sala pública). */
export const TurnFlags = ({ turn }) => (
  <>
    {turn.urg && <Badge tone="crit" icon={TriangleAlert} title={`Signo de alarma: ${turn.urg}. Pasa primero a triaje.`}>Urgencia</Badge>}
    {turn.pref && <Badge tone="info" title="Atención preferente (Ley N.° 27408): pasa primero a igual prioridad">{PREFERENTE[turn.pref]}</Badge>}
  </>
);

/** Opciones de un <select> de especialidad, agrupadas por rama de la cartera de servicios. */
export const EspOptions = () =>
  ESP_POR_RAMA.map((r) => (
    <optgroup key={r.k} label={r.n}>
      {r.esps.map((e) => <option key={e.k} value={e.k}>{e.n}</option>)}
    </optgroup>
  ));

/* ---------- Contenedores ---------- */

export function Panel({ title, sub, icon, count, actions, children, className = '', ...rest }) {
  return (
    <section className={`panel ${className}`} {...rest}>
      {(title || actions) && (
        <header className="panel-h">
          {icon && <Icono name={icon} size={30} />}
          <div className="titles">
            {title && <h2>{title}{count != null && <span className="count"><AnimatedNumber value={count} /></span>}</h2>}
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
    <Icono name={icon} size={56} />
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

/** Recorrido del paciente en miniatura: Admisión → Caja → Triaje → Cita → Consulta → Alta. */
export function MiniRoute({ state }) {
  const cur = ROUTE.findIndex((s) => s.states.includes(state));
  return (
    <ol className="mroute" aria-label={`Etapa: ${ROUTE[cur]?.n ?? 'Admisión'}`}>
      {ROUTE.map((s, i) => (
        <li
          key={s.k}
          title={s.n}
          className={i < cur ? 'done' : i === cur ? 'now' : ''}
          style={{ '--c': `var(--st-${s.c})` }}
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
 * Número animado como un odómetro de monitor: cuenta de forma progresiva hasta su valor (desde cero al aparecer,
 * salvo `fromZero={false}`) y cada dígito rueda en su propia columna, así un cambio de 12 a 13 no parpadea:
 * gira la cifra de las unidades. Sirve con cualquier formato (S/ 80.00, 94 %, 1 h 05 min): los dígitos ruedan
 * y el resto del texto queda fijo. Los valores que no son números se muestran tal cual.
 * Con movimiento reducido salta directo al valor. El lector de pantalla lee solo el valor final.
 */
export function AnimatedNumber({ value, format = (v) => fmtNum(Math.round(v)), fromZero = true, duration = 0.9 }) {
  const { reducido } = useMovimiento();
  const esNum = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState(() => (esNum && fromZero && !reducido ? 0 : value));
  const desde = useRef(shown);
  useEffect(() => {
    if (!esNum || reducido || typeof desde.current !== 'number') {
      desde.current = value;
      setShown(value);
      return undefined;
    }
    const ctl = animate(desde.current, value, {
      duration, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { desde.current = v; setShown(v); },
    });
    return () => ctl.stop();
  }, [value, esNum, reducido, duration]);
  const final = esNum ? format(value) : value ?? '—';
  const texto = typeof shown === 'number' ? format(shown) : final;
  const chars = [...String(texto)];
  return (
    <span className="odo">
      <span className="sr-only">{final}</span>
      <span className="odo-v" aria-hidden="true">
        {chars.map((c, i) => {
          const pos = chars.length - i; // desde la derecha: las unidades conservan su columna aunque crezca el número
          return /\d/.test(c)
            ? <span key={`d${pos}`} className="odo-d"><span className="odo-t" style={{ '--d': +c }}>{DIGITOS}</span></span>
            : <span key={`c${pos}${c}`} className="odo-c">{c}</span>;
        })}
      </span>
    </span>
  );
}
const DIGITOS = Array.from({ length: 10 }, (_, d) => <span key={d}>{d}</span>);
