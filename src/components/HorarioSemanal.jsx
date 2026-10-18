import { useStore } from '../store/useStore.js';
import { DIAS_SEMANA, ESPECIALIDADES } from '../lib/constants.js';
import { horariosDe, isoDow, especialidad } from '../lib/agenda.js';
import { useNow } from '../hooks/useNow.js';

/**
 * Horario semanal de los médicos, agrupado por especialidad: qué día y a qué hora atiende cada uno y en
 * qué consultorio. Es la base con la que el sistema calcula los cupos de cita.
 * `onRemove(h)` agrega un botón para quitar cada bloque (Jefatura).
 */
export function HorarioSemanal({ esp = null, onRemove }) {
  const { db } = useStore();
  const now = useNow(60_000);
  const today = isoDow(now);
  const days = DIAS_SEMANA.filter(([d]) => d < 7 || db.horarios.some((h) => h.on && h.dow === 7));
  const groups = ESPECIALIDADES.filter((e) => !esp || e.k === esp)
    .map((e) => ({ e, meds: db.users.filter((u) => u.role === 'med' && u.on && u.esp === e.k) }))
    .filter((g) => g.meds.length);
  if (!groups.length) return <p className="note">No hay médicos activos con horario registrado.</p>;
  return (
    <div className="tblw">
      <table className="tbl week">
        <thead>
          <tr>
            <th>Médico</th>
            {days.map(([d, n]) => <th key={d} className={d === today ? 'today' : ''}>{n.slice(0, 3)}{d === today && <small> (hoy)</small>}</th>)}
          </tr>
        </thead>
        {groups.map(({ e, meds }) => (
          <tbody key={e.k}>
            <tr className="grp"><th colSpan={days.length + 1}>{e.n} <small>citas de {especialidad(e.k).dur} min</small></th></tr>
            {meds.map((u) => (
              <tr key={u.u}>
                <td><b>{u.n}</b></td>
                {days.map(([d]) => {
                  const hs = horariosDe(db.horarios, u.u, d);
                  return (
                    <td key={d} className={`${d === today ? 'today' : ''} ${hs.length ? 'on' : 'off'}`}>
                      {hs.length ? hs.map((h) => (
                        <span className="slot-b" key={h.id}>
                          {h.ini}–{h.fin}<small>{h.area}</small>
                          {onRemove && <button type="button" className="linkbtn" onClick={() => onRemove(h)} aria-label={`Quitar el bloque de ${u.n}, ${h.ini} a ${h.fin}`}>Quitar</button>}
                        </span>
                      )) : <span className="no" aria-label="No atiende">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
