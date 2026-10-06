import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { CircleHelp } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { ROLES } from '../lib/constants.js';
import { minutesBetween } from '../lib/clinical.js';
import { mean } from '../lib/analytics.js';
import { startOfToday, fmtMin } from '../lib/format.js';
import { pop } from '../lib/motion.js';
import { AnimatedNumber } from './ui.jsx';
import { Icon3D } from './Icon3D.jsx';
import { RouteStrip } from './RouteStrip.jsx';
import { useDismiss } from '../hooks/useDismiss.js';

/** Qué hace cada rol y en qué orden (se consulta desde el botón de ayuda). */
const GUIDE = {
  adm: {
    lead: 'Identifique al paciente por DNI, verifique el SIS y genere el turno. El turno pasa solo a la lista de triaje.',
    steps: ['Busque al paciente por DNI', 'Verifique el SIS y sus datos', 'Genere el turno', 'Entregue el ticket'],
  },
  enf: {
    lead: 'Llame al siguiente paciente y registre sus signos vitales. El sistema calcula el IMC y la prioridad con los umbrales aprobados.',
    steps: ['Llame al siguiente', 'Inicie el triaje', 'Registre los signos vitales', 'Guarde: la prioridad es automática'],
  },
  med: {
    lead: 'La lista se ordena por prioridad clínica y hora de llegada. Al cerrar la atención se emite la receta y su consultorio queda libre.',
    steps: ['Elija su consultorio', 'Llame al siguiente', 'Inicie la atención', 'Diagnóstico, receta y alta'],
  },
  jef: {
    lead: 'Supervise los tiempos de atención, administre las cuentas del personal, registre los umbrales clínicos y revise la auditoría.',
    steps: ['Revise el tablero gerencial', 'Siga el flujo en vivo', 'Gestione usuarios y umbrales', 'Revise la auditoría'],
  },
};

/** Promedio en minutos entre dos marcas de los turnos dados (null si no hay datos). */
const meanMin = (turns, a, b) => mean(turns.map((t) => minutesBetween(t, a, b)).filter((v) => v != null));
const asMin = (v) => fmtMin(v);

/**
 * Cifras del día de cada rol: [valor, etiqueta, alerta si > 0, formato]. Complementan la ruta en vivo
 * (que ya muestra cuántos esperan en cada etapa), no la repiten.
 */
function figures(db, user, area, patient) {
  const today = startOfToday();
  const hoy = db.turns.filter((t) => t.t0 >= today);
  const pat = (t) => patient(t.dni);
  switch (user.role) {
    case 'adm':
      return [
        [hoy.filter((t) => pat(t)?.sis === 'PENDIENTE_VALIDACION').length, 'SIS pendiente de validación', true],
        [hoy.filter((t) => pat(t)?.sis === 'NO_ASEGURADO').length, 'Pacientes no asegurados hoy'],
        [hoy.filter((t) => t.state === 'CANCELADO').length, 'Turnos cancelados hoy'],
        [meanMin(hoy, 't0', 'tTriCall'), 'Espera media hasta triaje', false, asMin],
      ];
    case 'enf':
      return [
        [db.turns.filter((t) => t.tTriSave >= today).length, 'Triajes registrados hoy'],
        [db.turns.filter((t) => t.tTriSave >= today && t.prio === 'CRITICA').length, 'Críticos detectados hoy', true],
        [meanMin(hoy, 'tTriCall', 'tTriSave'), 'Duración media del triaje', false, asMin],
        [db.turns.filter((t) => t.state === 'LLAMADO_TRIAJE' && (t.calls || 0) > 1).length, 'Llamados repetidos sin presentarse', true],
      ];
    default: {
      const mine = db.turns.filter((t) => t.consult?.medico?.u === user.u && t.consult.t >= today);
      return [
        [db.turns.filter((t) => t.state === 'EN_ESPERA_CONSULTA' && t.prio !== 'NORMAL').length, 'Críticos o prioritarios en espera', true],
        [mine.length, 'Atendidos por usted hoy'],
        [meanMin(mine, 'tMedCall', 'tEnd'), 'Su consulta media hoy', false, asMin],
        [area, 'Su consultorio'],
      ];
    }
  }
}

function Help({ role }) {
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
 * Encabezado de cada sección: título, propósito y, según la sección, la ruta en vivo y las cifras del día.
 */
export function WorkspaceHeader({ title, icon, lead, route = false, figs = false }) {
  const { db, user, area, patient } = useStore();
  const role = user.role;
  return (
    <header className="ws">
      <div className="ws-title">
        <Icon3D name={icon || ROLES[role].icon} size={56} />
        <div className="t">
          <h1>{title}</h1>
          <p>{lead || GUIDE[role].lead}</p>
        </div>
        <Help role={role} />
      </div>
      {route && (
        <>
          <RouteStrip here={role === 'jef' ? null : role} />
          <div className="route-legend" aria-hidden="true">
            <span><i className="pdot" style={{ background: 'var(--crit)' }} />Crítica</span>
            <span><i className="pdot" style={{ background: 'var(--warn)' }} />Prioritaria</span>
            <span><i className="pdot" style={{ background: 'var(--good)' }} />Normal</span>
            <span><i className="pdot" style={{ background: 'var(--line-strong)' }} />Sin triaje</span>
            <span>Borde rojo: supera el tiempo objetivo de espera</span>
          </div>
        </>
      )}
      {figs && (
        <div className="figs">
          {figures(db, user, area, patient).map(([v, l, alert, format]) => (
            <div className={`fig ${alert && v > 0 ? 'alert' : ''}`} key={l}>
              <span>{l}</span>
              <b><AnimatedNumber value={v} format={format} /></b>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
