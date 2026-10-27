import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { CalendarCheck, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { assignCita } from '../store/actions.js';
import { turnKey } from '../lib/clinical.js';
import { ESPECIALIDADES, MIN } from '../lib/constants.js';
import {
  cuposLibres, deTurnoHoy, diaNombre, diasDeAtencion, especialidad, especialidadSugerida,
  isoDow, listaDias, porDia, sameDay, sobrecupo, sugerirCita,
} from '../lib/agenda.js';
import { age, fmtCitaDia, fmtHora, fullName, initials, tonoDia } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { Badge, Msg, PrioBadge, StateBadge, TurnCode } from './ui.jsx';

/** «hoy 10:40 con Dra. Elena Ríos (demo), Consultorio 1». */
export function CitaLine({ c, now }) {
  const { db } = useStore();
  const doc = db.users.find((x) => x.u === c.med);
  return (
    <span className="cita-line">
      <b>{fmtCitaDia(c.at, now)} a las {fmtHora(c.at)}</b>, {especialidad(c.esp)?.n}, {doc?.n ?? c.med}, {c.area}
      {c.sobre && <Badge tone="crit">Sobrecupo</Badge>}
    </span>
  );
}

const SUG_TEXT = {
  hoy: 'Primer cupo libre de hoy.',
  'otro-dia': 'Hoy no hay cupo en esta especialidad: el primer cupo libre es otro día.',
  'mg-hoy': 'Paciente prioritario: la especialidad no tiene cupo hoy, por eso se propone Medicina General hoy mismo.',
  sobrecupo: 'Prioridad crítica: se atiende hoy como sobrecupo, sin esperar un cupo libre.',
};

const DIAS_TABLERO = 4;

/** Nombre corto del médico para las tarjetas: «Dra. Ríos». */
const corto = (n = '') => {
  const s = n.replace(/\s*\(demo\)/, '').trim().split(/\s+/);
  return s[0].endsWith('.') && s.length > 2 ? `${s[0]} ${s[s.length - 1]}` : s.slice(0, 2).join(' ');
};

/**
 * Asignación de la cita como un tablero: una columna por día y una tarjeta por cupo libre del horario de cada
 * médico. La cita que propone el sistema viene marcada; basta un clic para elegir otra y otro para confirmar.
 * Para un paciente crítico solo hay sobrecupo hoy con el médico de turno.
 */
export function CitaForm({ turn, patient, onDone, preselect = false }) {
  const { db, run } = useStore();
  const now = useNow(30_000);
  const except = turnKey(turn);
  const suggested = especialidadSugerida(patient, turn.tri, now);
  const [esp, setEsp] = useState(() => turn.cita?.esp ?? suggested);
  const [ndias, setNdias] = useState(DIAS_TABLERO);
  const crit = turn.prio === 'CRITICA';
  const sugDe = (k) => (crit
    ? (deTurnoHoy(db, now, k)[0] && sobrecupo(deTurnoHoy(db, now, k)[0], now))
    : sugerirCita(db, k, turn.prio, now, except)?.cita) ?? null;
  // La cita sugerida viene ya elegida (desde el triaje o en Admisión): basta con confirmarla
  const [pick, setPick] = useState(() => (preselect ? sugDe(turn.cita?.esp ?? suggested) : null));
  const sug = sugDe(esp);
  const sugInfo = crit ? null : sugerirCita(db, esp, turn.prio, now, except);
  const e = especialidad(esp);
  const dows = diasDeAtencion(db, esp);
  const docName = (u) => db.users.find((x) => x.u === u)?.n ?? u;
  const guardia = crit ? deTurnoHoy(db, now, esp) : [];
  const todos = crit ? [] : porDia(cuposLibres(db, esp, now, { except, dias: 30 }));
  const dias = todos.slice(0, ndias);
  const es = (c) => pick && pick.at === c.at && pick.med === c.med;
  const esSug = (c) => sug && sug.at === c.at && sug.med === c.med;
  const elegir = (c) => setPick({ esp, med: c.med, area: c.area, at: c.at, sobre: !!c.sobre });

  const cambiarEsp = (k) => {
    setEsp(k);
    setNdias(DIAS_TABLERO);
    setPick(preselect ? sugDe(k) : null);
  };
  const submit = async () => {
    const r = await run(assignCita, turn.id, pick);
    if (r.ok) onDone(r.result);
  };

  return (
    <div className="stack">
      <div className="ficha" data-prio={turn.prio}>
        <span className="ficha-av" aria-hidden="true">{initials(fullName(patient))}</span>
        <div className="ficha-main">
          <b>{fullName(patient)}</b>
          <ul className="ficha-tags">
            <li>{turn.id}</li>
            <li>{age(patient.nac)} años</li>
            {turn.tri?.motivo && <li>{turn.tri.motivo}</li>}
          </ul>
        </div>
        <PrioBadge prio={turn.prio} />
      </div>
      {turn.cita && <p className="note">Cita actual: <CitaLine c={turn.cita} now={now} /></p>}

      <div className="esp-pills" role="group" aria-label="Especialidad">
        {ESPECIALIDADES.map((x) => (
          <button key={x.k} type="button" className="esp-pill" style={{ '--e': `var(--esp-${x.k})` }} aria-pressed={esp === x.k} onClick={() => cambiarEsp(x.k)}>
            <b>{x.n}</b>
            <small>{x.k === suggested ? '✦ Sugerida' : listaDias(diasDeAtencion(db, x.k))}</small>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {pick && (
          <m.div {...listItem} className="pick-sum" style={{ '--e': pick.sobre ? 'var(--crit)' : `var(--esp-${pick.esp})` }}>
            <CalendarCheck aria-hidden="true" />
            <span>
              <b>{fmtCitaDia(pick.at, now)} a las {fmtHora(pick.at)}</b> · {especialidad(pick.esp)?.n} · {docName(pick.med)} · {pick.area}
              {pick.sobre && <Badge tone="crit">Sobrecupo</Badge>}
            </span>
            <button type="button" className="btn lg" onClick={submit}>{turn.cita ? 'Reprogramar' : 'Confirmar cita'}</button>
          </m.div>
        )}
      </AnimatePresence>

      {crit ? (
        guardia.length ? (
          <>
            <Msg tone="crit"><b>Prioridad crítica:</b> se atiende hoy como sobrecupo. Elija al médico que está de turno.</Msg>
            <div className="cupo-grid">
              {guardia.map((d) => {
                const c = sobrecupo(d, now);
                return (
                  <button key={d.med} type="button" className="cupo sobre" style={{ '--e': 'var(--crit)' }} aria-pressed={es(c)} onClick={() => elegir(c)}>
                    <b>{d.ahora ? 'Ahora' : `Desde ${d.ini}`}</b>
                    <span>{corto(docName(d.med))}</span>
                    <small>{d.area}</small>
                  </button>
                );
              })}
            </div>
          </>
        ) : <Msg tone="crit"><b>Ningún médico atiende hoy.</b> Derive al paciente crítico a la emergencia del hospital de referencia.</Msg>
      ) : !dias.length ? (
        <Msg tone="warn">No hay cupos libres de {e.n} en los próximos 30 días. Pida a Jefatura ampliar el horario.</Msg>
      ) : (
        <>
          <p className="tablero-nota">
            <Sparkles aria-hidden="true" />
            {sugInfo ? <span><b>Sugerida:</b> {SUG_TEXT[sugInfo.motivo]}</span> : null}
            {!dows.includes(isoDow(now)) && <span> {e.n} no atiende hoy ({diaNombre(isoDow(now)).toLowerCase()}).</span>}
          </p>
          <div className="tablero" style={{ '--e': `var(--esp-${esp})`, '--cols': dias.length }} role="group" aria-label={`Cupos libres de ${e.n}`}>
            {dias.map((d) => {
              const porMed = [...new Set(d.cupos.map((c) => c.med))];
              return (
                <section key={d.day} className="tab-col" data-dia={tonoDia(d.day, now)}>
                  <header>
                    <b>{fmtCitaDia(d.day, now)}</b>
                    <small>{d.cupos.length} libres</small>
                  </header>
                  {porMed.map((u) => (
                    <div key={u} className="tab-med">
                      <span className="tab-doc" title={docName(u)}>{corto(docName(u))} · {d.cupos.find((c) => c.med === u).area.replace('Consultorio ', 'C')}</span>
                      <div className="tab-cupos">
                        {d.cupos.filter((c) => c.med === u).map((c) => (
                          <button key={c.at} type="button" className={`cupo ${esSug(c) ? 'sug' : ''}`} aria-pressed={es(c)} onClick={() => elegir(c)}
                            aria-label={`${fmtCitaDia(c.at, now)} a las ${fmtHora(c.at)} con ${docName(u)}${esSug(c) ? ' (sugerida)' : ''}`}>
                            {fmtHora(c.at)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
          {todos.length > ndias && (
            <button type="button" className="btn ghost sm" onClick={() => setNdias((n) => n + DIAS_TABLERO)}>Ver más días</button>
          )}
        </>
      )}

    </div>
  );
}

/**
 * Tarjeta de una cita (de hoy, próxima o vencida): la hora en un bloque con el color de la especialidad,
 * el paciente, el médico y sus acciones.
 */
export function CitaRow({ t, now, actions }) {
  const { db, patient } = useStore();
  const c = t.cita;
  const late = t.state === 'CITADO' && sameDay(c.at, now) && now > c.at + 15 * MIN;
  const doc = db.users.find((x) => x.u === c.med);
  return (
    <m.li {...listItem} layout className={`cita-card ${t.prio === 'CRITICA' ? 'crit' : ''}`} data-dia={tonoDia(c.at, now)} data-cerrada={['ATENDIDO', 'CANCELADO'].includes(t.state) || undefined} style={{ '--e': `var(--esp-${c.esp})` }}>
      <div className="cc-time">
        <b>{fmtHora(c.at)}</b>
        <small>{fmtCitaDia(c.at, now)}</small>
      </div>
      <div className="cc-main">
        <div className="cc-top">
          <b>{fullName(patient(t.dni))}</b>
          {t.state === 'CITADO' ? <Badge tone={late ? 'crit' : 'info'}>{late ? 'Atrasado' : 'Por llegar'}</Badge> : <StateBadge state={t.state} />}
        </div>
        <span className="cc-meta">
          <TurnCode id={t.id} />
          <span className="cc-esp">{especialidad(c.esp)?.n}</span>
          <span>{doc?.n ?? c.med} · {c.area}</span>
          {c.sobre && <Badge tone="crit">Sobrecupo</Badge>}
          {!t.tTriSave && t.state === 'CITADO' && <Badge tone="info">{c.by === 'a.citasweb' ? 'Reservó por web' : 'Reservó por teléfono'}</Badge>}
        </span>
        {actions && <div className="cc-acts">{actions}</div>}
      </div>
    </m.li>
  );
}
