import { X } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { DIAS_SEMANA, ESPECIALIDADES } from '../lib/constants.js';
import { horariosDe, isoDow, especialidad, toMin } from '../lib/agenda.js';
import { initials } from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';

// La barra de cada bloque representa el día de atención posible (06:00 a 22:00)
const DIA_INI = 6 * 60;
const DIA_FIN = 22 * 60;
const pct = (min) => `${((Math.min(Math.max(min, DIA_INI), DIA_FIN) - DIA_INI) / (DIA_FIN - DIA_INI)) * 100}%`;
const horas = (h) => (toMin(h.fin) - toMin(h.ini)) / 60;

/**
 * Horario semanal de los médicos, agrupado por especialidad: una fila por médico y una tarjeta por bloque, con
 * su hora sobre una barra del día y el consultorio. Hoy se resalta y, si el médico está en su bloque, se marca
 * «Atendiendo». Es la base con la que el sistema calcula los cupos de cita.
 * `onRemove(h)` agrega un botón para quitar cada bloque (Jefatura).
 */
export function HorarioSemanal({ esp = null, onRemove }) {
  const { db } = useStore();
  const now = useNow(60_000);
  const today = isoDow(now);
  const ahora = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const days = DIAS_SEMANA.filter(([d]) => d < 7 || db.horarios.some((h) => h.on && h.dow === 7));
  const groups = ESPECIALIDADES.filter((e) => !esp || e.k === esp)
    .map((e) => ({ e, meds: db.users.filter((u) => u.role === 'med' && u.on && u.esp === e.k) }))
    .filter((g) => g.meds.length);
  if (!groups.length) return <p className="note">No hay médicos activos con horario registrado.</p>;

  return (
    <div className="hs" style={{ '--days': days.length }}>
      <div className="hs-row hs-head" aria-hidden="true">
        <span />
        {days.map(([d, n]) => (
          <span key={d} className={d === today ? 'today' : ''}>{n.slice(0, 3)}{d === today && <small>Hoy</small>}</span>
        ))}
      </div>
      {groups.map(({ e, meds }) => (
        <section key={e.k} className="hs-esp" style={{ '--e': `var(--esp-${e.k})` }} aria-label={e.n}>
          <h4><i aria-hidden="true" />{e.n}<small>citas de {especialidad(e.k).dur} min</small></h4>
          {meds.map((u) => {
            const total = days.reduce((s, [d]) => s + horariosDe(db.horarios, u.u, d).reduce((a, h) => a + horas(h), 0), 0);
            return (
              <div key={u.u} className="hs-row">
                <div className="hs-doc">
                  <span className="hs-av" aria-hidden="true">{initials(u.n)}</span>
                  <span><b>{u.n}</b><small>{total} h por semana</small></span>
                </div>
                {days.map(([d, n]) => {
                  const hs = horariosDe(db.horarios, u.u, d);
                  return (
                    <div key={d} className={`hs-cell ${d === today ? 'today' : ''}`} aria-label={`${n}: ${hs.length ? hs.map((h) => `${h.ini} a ${h.fin}, ${h.area}`).join('; ') : 'no atiende'}`}>
                      {hs.length ? hs.map((h) => {
                        const en = d === today && ahora >= toMin(h.ini) && ahora < toMin(h.fin);
                        return (
                          <div key={h.id} className={`hs-b ${en ? 'live' : ''}`}>
                            <b>{h.ini}–{h.fin}</b>
                            <span className="hs-bar" aria-hidden="true"><i style={{ left: pct(toMin(h.ini)), right: `calc(100% - ${pct(toMin(h.fin))})` }} /></span>
                            <small>{en ? 'Atendiendo ahora' : h.area}</small>
                            {onRemove && (
                              <button type="button" className="hs-x" onClick={() => onRemove(h)} aria-label={`Quitar el bloque de ${u.n}, ${n} de ${h.ini} a ${h.fin}`} title="Quitar bloque"><X /></button>
                            )}
                          </div>
                        );
                      }) : <span className="hs-off">Descanso</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
