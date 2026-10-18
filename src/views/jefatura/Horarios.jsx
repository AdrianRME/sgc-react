import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useStore } from '../../store/useStore.js';
import { saveHorario, removeHorario } from '../../store/actions.js';
import { AREAS, DIAS_SEMANA } from '../../lib/constants.js';
import { especialidad, toMin } from '../../lib/agenda.js';
import { WorkspaceHeader } from '../../components/WorkspaceHeader.jsx';
import { Field, Msg, Panel } from '../../components/ui.jsx';
import { HorarioSemanal } from '../../components/HorarioSemanal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import './jefatura.css';

const EMPTY = { med: '', dow: 1, ini: '08:00', fin: '13:00', area: AREAS[0] };

/**
 * Horarios de atención de los médicos. Cada bloque (día, hora de inicio y fin, consultorio) se divide en
 * cupos de la duración de la especialidad: así el sistema sabe qué días atiende cada especialista y qué
 * cupos ofrecer al dar una cita.
 */
export default function Horarios() {
  const { db, run } = useStore();
  const [ask, dialog] = useConfirm();
  const [f, setF] = useState(EMPTY);
  const meds = db.users.filter((u) => u.role === 'med' && u.on);
  const doc = meds.find((u) => u.u === f.med);
  const e = doc && especialidad(doc.esp);
  const span = toMin(f.fin) - toMin(f.ini);
  const cupos = e && span > 0 ? Math.floor(span / e.dur) : 0;
  const set = (k) => (ev) => setF((x) => ({ ...x, [k]: ev.target.value }));

  const submit = async (ev) => {
    ev.preventDefault();
    const r = await run(saveHorario, f);
    if (r.ok) setF((x) => ({ ...EMPTY, med: x.med }));
  };
  const remove = (h) => ask({
    title: 'Quitar bloque de horario',
    text: `${db.users.find((u) => u.u === h.med)?.n}: ${DIAS_SEMANA.find(([d]) => d === h.dow)[1].toLowerCase()} de ${h.ini} a ${h.fin}. Ya no se darán citas en ese horario.`,
    confirmLabel: 'Quitar',
    danger: true,
    onConfirm: () => run(removeHorario, h.id),
  });

  return (
    <>
      <WorkspaceHeader title="Horarios médicos" icon="calendar"
        lead="Defina qué días y a qué hora atiende cada médico. Con este horario el sistema calcula los cupos de cita y sabe, por ejemplo, que un especialista que no atiende los martes no puede recibir citas ese día." />
      <Panel title="Agregar bloque" icon="sparkles" className="horario-form">
        <form onSubmit={submit} noValidate className="horario-grid">
          <Field label="Médico" hint={e ? `${e.n}: citas de ${e.dur} min` : 'Solo médicos activos con especialidad'}>
            {(a) => (
              <select {...a} value={f.med} onChange={set('med')}>
                <option value="">Elija un médico</option>
                {meds.map((u) => <option key={u.u} value={u.u}>{u.n} ({especialidad(u.esp)?.n ?? 'sin especialidad'})</option>)}
              </select>
            )}
          </Field>
            <Field label="Día">
              {(a) => (
                <select {...a} value={f.dow} onChange={set('dow')}>
                  {DIAS_SEMANA.map(([d, n]) => <option key={d} value={d}>{n}</option>)}
                </select>
              )}
            </Field>
            <Field label="Consultorio">
              {(a) => (
                <select {...a} value={f.area} onChange={set('area')}>
                  {AREAS.map((x) => <option key={x}>{x}</option>)}
                </select>
              )}
            </Field>
            <Field label="Desde">{(a) => <input {...a} type="time" step="900" value={f.ini} onChange={set('ini')} />}</Field>
            <Field label="Hasta">{(a) => <input {...a} type="time" step="900" value={f.fin} onChange={set('fin')} />}</Field>
          {e && cupos > 0 && <Msg tone="info">Este bloque da <b>{cupos} cupos</b> de {e.n} ese día.</Msg>}
          <div className="actions">
            <button className="btn" disabled={!f.med}><CalendarPlus /> Agregar al horario</button>
          </div>
          <p className="note">El sistema no permite cruzar dos bloques del mismo médico ni dar el mismo consultorio a dos médicos a la misma hora. Un bloque con citas por atender no se puede quitar hasta reprogramarlas.</p>
        </form>
      </Panel>
      <Panel title="Horario semanal" icon="calendar" sub="Cada bloque se divide en cupos según la duración de la cita de la especialidad">
        <HorarioSemanal onRemove={remove} />
      </Panel>
      {dialog}
    </>
  );
}
