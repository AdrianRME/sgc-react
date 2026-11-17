import { Fragment } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { DIAS_SEMANA, ESPECIALIDADES, RAMAS } from '../lib/constants.js';
import { horariosDe, isoDow, especialidad, toMin } from '../lib/agenda.js';
import { initials } from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';
import { Acordeon, Grupo, RotuloGrupo } from './Acordeon.jsx';
import { Badge } from './ui.jsx';

// La barra de cada bloque representa el día de atención posible (06:00 a 22:00)
const DIA_INI = 6 * 60;
const DIA_FIN = 22 * 60;
const pct = (min) => `${((Math.min(Math.max(min, DIA_INI), DIA_FIN) - DIA_INI) / (DIA_FIN - DIA_INI)) * 100}%`;
const horas = (h) => (toMin(h.fin) - toMin(h.ini)) / 60;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Horario semanal de los profesionales. Cada especialidad es un grupo plegable (agrupadas por rama): cerrado,
 * resume cuántos profesionales tiene y si atiende hoy; abierto, muestra una fila por profesional y una tarjeta
 * por bloque, con su hora sobre una barra del día y el consultorio. Así la pantalla no crece con cada médico
 * que se contrata. Hoy se resalta y, si el médico está en su bloque, se marca «Atendiendo».
 * `esp` muestra solo una especialidad (abierta). `onRemove(h)` agrega un botón para quitar cada bloque (Jefatura).
 */
export function HorarioSemanal({ esp = null, onRemove }) {
  const { db } = useStore();
  const now = useNow(60_000);
  const today = isoDow(now);
  const ahora = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  // Días de esta semana: los que ya pasaron se atenúan, los que vienen van un tono menor y hoy resalta
  const dia = (d) => (d === today ? 'today' : d < today ? 'past' : 'next');
  const days = DIAS_SEMANA.filter(([d]) => d < 7 || db.horarios.some((h) => h.on && h.dow === 7));
  const enBloque = (u) => horariosDe(db.horarios, u.u, today).some((h) => ahora >= toMin(h.ini) && ahora < toMin(h.fin));
  const groups = ESPECIALIDADES.filter((e) => !esp || e.k === esp)
    .map((e) => {
      const meds = db.users.filter((u) => u.role === 'med' && u.on && u.esp === e.k);
      return { e, meds, hoy: meds.filter((u) => horariosDe(db.horarios, u.u, today).length).length, ahora: meds.filter(enBloque).length };
    })
    .filter((g) => g.meds.length);
  if (!groups.length) return <p className="note">No hay médicos activos con horario registrado.</p>;
  const total = groups.reduce((s, g) => s + g.meds.length, 0);

  return (
    <Acordeon className="hs" rotulo={`${plural(groups.length, 'especialidad', 'especialidades')} · ${plural(total, 'profesional', 'profesionales')}`} barra={groups.length > 1}>
      {groups.map(({ e, meds, hoy, ahora: n }, i) => (
        <Fragment key={e.k}>
          {(i === 0 || groups[i - 1].e.rama !== e.rama) && <RotuloGrupo>{RAMAS.find((r) => r.k === e.rama)?.n}</RotuloGrupo>}
          <Grupo
            titulo={e.n}
            sub={`${plural(meds.length, 'profesional', 'profesionales')} · citas de ${especialidad(e.k).dur} min · ${hoy ? `${hoy} ${hoy === 1 ? 'atiende' : 'atienden'} hoy` : 'no atiende hoy'}`}
            cuenta={meds.length}
            color={`var(--esp-${e.k})`}
            abierto={!!esp || groups.length === 1}
            extra={n > 0 && <Badge tone="ok"><i className="dot vivo" aria-hidden="true" />Atendiendo ahora</Badge>}
          >
            <div className="hs-scroll" style={{ '--days': days.length, '--e': `var(--esp-${e.k})` }}>
              <div className="hs-row hs-head" aria-hidden="true">
                <span />
                {days.map(([d, nombre]) => (
                  <span key={d} className={dia(d)}>{nombre.slice(0, 3)}{d === today && <small>Hoy</small>}</span>
                ))}
              </div>
              {meds.map((u) => {
                const semana = days.reduce((s, [d]) => s + horariosDe(db.horarios, u.u, d).reduce((a, h) => a + horas(h), 0), 0);
                return (
                  <div key={u.u} className="hs-row">
                    <div className="hs-doc">
                      <span className="hs-av" aria-hidden="true">{initials(u.n)}</span>
                      <span><b>{u.n}</b><small>{semana} h por semana</small></span>
                    </div>
                    {days.map(([d, nombre]) => {
                      const hs = horariosDe(db.horarios, u.u, d);
                      return (
                        <div key={d} className={`hs-cell ${dia(d)}`} aria-label={`${nombre}: ${hs.length ? hs.map((h) => `${h.ini} a ${h.fin}, ${h.area}`).join('; ') : 'no atiende'}`}>
                          {hs.length ? hs.map((h) => {
                            const en = d === today && ahora >= toMin(h.ini) && ahora < toMin(h.fin);
                            return (
                              <div key={h.id} className={`hs-b ${en ? 'live' : ''}`}>
                                <b>{h.ini}–{h.fin}</b>
                                <span className="hs-bar" aria-hidden="true"><i style={{ left: pct(toMin(h.ini)), right: `calc(100% - ${pct(toMin(h.fin))})` }} /></span>
                                <small>{en ? 'Atendiendo ahora' : h.area}</small>
                                {onRemove && (
                                  <button type="button" className="hs-x" onClick={() => onRemove(h)} aria-label={`Quitar el bloque de ${u.n}, ${nombre} de ${h.ini} a ${h.fin}`} title="Quitar bloque"><X /></button>
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
            </div>
          </Grupo>
        </Fragment>
      ))}
    </Acordeon>
  );
}
