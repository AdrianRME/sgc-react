import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Ban, CalendarCheck, CalendarClock, LogIn, Sparkles, UserX } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { assignCita, cancelTurn, checkIn } from '../store/actions.js';
import { byPriority, turnKey } from '../lib/clinical.js';
import { CANCEL, ESPECIALIDADES, MIN, QUEUE } from '../lib/constants.js';
import {
  citasDelDia, cuposLibres, deTurnoHoy, diaNombre, diasDeAtencion, especialidad, especialidadSugerida,
  isoDow, listaDias, porDia, sameDay, sobrecupo, sugerirCita,
} from '../lib/agenda.js';
import { age, fmtCitaDia, fmtHora, fullName, initials, startOfDay } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { WorkspaceHeader } from '../components/WorkspaceHeader.jsx';
import { Badge, Empty, Field, Msg, Panel, PrioBadge, Segmented, StateBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { Modal } from '../components/Modal.jsx';
import { HorarioSemanal } from '../components/HorarioSemanal.jsx';
import './workspaces.css';

const DAYS_SHOWN = 8;

/** «hoy 10:40 con Dra. Elena Ríos (demo), Consultorio 1». */
function CitaLine({ c, now }) {
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

/**
 * Asignación de la cita. El sistema propone la especialidad (por edad y motivo) y la cita (por prioridad,
 * horario de los médicos y cupos libres). Admisión puede elegir otro cupo; el sistema lo vuelve a validar.
 */
export function CitaForm({ turn, patient, onDone }) {
  const { db, run } = useStore();
  const now = useNow(30_000);
  const except = turnKey(turn);
  const [esp, setEsp] = useState(() => turn.cita?.esp ?? especialidadSugerida(patient, turn.tri, now));
  const [med, setMed] = useState('');
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const suggested = especialidadSugerida(patient, turn.tri, now);
  const crit = turn.prio === 'CRITICA';
  const e = especialidad(esp);
  const dows = diasDeAtencion(db, esp);
  const meds = db.users.filter((u) => u.role === 'med' && u.on && u.esp === esp);
  const sug = sugerirCita(db, esp, turn.prio, now, except);
  const guardia = crit ? deTurnoHoy(db, now, esp) : [];
  const dias = crit ? [] : porDia(cuposLibres(db, esp, now, { med: med || null, except, dias: 30 })).slice(0, DAYS_SHOWN);
  const curDay = dias.find((d) => d.day === day) ?? dias[0];
  const docName = (u) => db.users.find((x) => x.u === u)?.n ?? u;
  const reset = () => {
    setPick(null);
    setDay(null);
  };

  const submit = async () => {
    const r = await run(assignCita, turn.id, pick);
    if (r.ok) onDone(r.result);
  };

  return (
    <div className="stack">
      <div className="patient-card">
        <TurnCode id={turn.id} className="big" />
        <div className="pc-main">
          <b>{fullName(patient)}</b>
          <small>{age(patient.nac)} años · {turn.tri?.motivo}</small>
        </div>
        <PrioBadge prio={turn.prio} />
      </div>
      {turn.cita && <p className="note">Cita actual: <CitaLine c={turn.cita} now={now} /></p>}

      <div className="row">
        <Field label="Especialidad" hint={esp === suggested ? 'Sugerida por el sistema según la edad y el motivo de consulta' : `El sistema sugiere ${especialidad(suggested).n}`}>
          {(a) => (
            <select {...a} value={esp} onChange={(ev) => { setEsp(ev.target.value); setMed(''); reset(); }}>
              {ESPECIALIDADES.map((x) => <option key={x.k} value={x.k}>{x.n}{x.k === suggested ? ' (sugerida)' : ''}</option>)}
            </select>
          )}
        </Field>
        {!crit && (
          <Field label="Médico">
            {(a) => (
              <select {...a} value={med} onChange={(ev) => { setMed(ev.target.value); reset(); }}>
                <option value="">Cualquiera (primer cupo libre)</option>
                {meds.map((u) => <option key={u.u} value={u.u}>{u.n}</option>)}
              </select>
            )}
          </Field>
        )}
      </div>

      <p className="note">
        <b>{e.n}</b> atiende los {listaDias(dows)}, en citas de {e.dur} min.
        {!dows.includes(isoDow(now)) && <> Hoy ({diaNombre(isoDow(now)).toLowerCase()}) <b>no atiende</b>: la cita será otro día.</>}
      </p>

      {crit ? (
        guardia.length ? (
          <>
            <Msg tone="crit"><b>Prioridad crítica.</b> {SUG_TEXT.sobrecupo} Elija el médico de turno:</Msg>
            <div className="slots">
              {guardia.map((d) => {
                const c = sobrecupo(d, now);
                const on = pick?.med === c.med;
                return (
                  <button key={d.med} type="button" className={`slot wide ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setPick(c)}>
                    <b>{d.ahora ? 'Ahora' : `Desde ${d.ini}`}</b>
                    <small>{docName(d.med)}, {especialidad(d.esp).n}, {d.area}</small>
                  </button>
                );
              })}
            </div>
          </>
        ) : <Msg tone="crit"><b>Ningún médico atiende hoy.</b> Derive al paciente crítico a la emergencia del hospital de referencia.</Msg>
      ) : (
        <>
          {sug ? (
            <div className={`suggest ${pick && pick.at === sug.cita.at && pick.med === sug.cita.med ? 'on' : ''}`}>
              <Sparkles aria-hidden="true" />
              <div>
                <small>El sistema sugiere</small>
                <CitaLine c={sug.cita} now={now} />
                <span className="note">{SUG_TEXT[sug.motivo]}</span>
              </div>
              <button type="button" className="btn sec sm" onClick={() => setPick(sug.cita)}>Usar esta cita</button>
            </div>
          ) : <Msg tone="warn">No hay cupos libres de {e.n} en los próximos 30 días. Pida a Jefatura ampliar el horario.</Msg>}

          {dias.length > 0 && (
            <div className="field">
              <label>Otros cupos libres</label>
              <div className="day-chips" role="group" aria-label="Día de la cita">
                {dias.map((d) => (
                  <button key={d.day} type="button" className={`chip ${curDay?.day === d.day ? 'on' : ''}`} aria-pressed={curDay?.day === d.day} onClick={() => setDay(d.day)}>
                    <b>{fmtCitaDia(d.day, now)}</b><small>{d.cupos.length} cupos</small>
                  </button>
                ))}
              </div>
              <div className="slots" role="group" aria-label="Hora de la cita">
                {curDay?.cupos.map((c) => {
                  const on = pick?.at === c.at && pick?.med === c.med;
                  return (
                    <button key={`${c.med}-${c.at}`} type="button" className={`slot ${on ? 'on' : ''}`} aria-pressed={on}
                      title={`${docName(c.med)}, ${c.area}`} onClick={() => setPick({ esp, med: c.med, area: c.area, at: c.at, sobre: false })}>
                      <b>{fmtHora(c.at)}</b><small>{initials(docName(c.med))}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {pick && (
          <m.div {...listItem} className="pick-sum">
            <CalendarCheck aria-hidden="true" />
            <span>Cita elegida: <CitaLine c={pick} now={now} /></span>
            <button type="button" className="btn" onClick={submit}>{turn.cita ? 'Reprogramar cita' : 'Confirmar cita'}</button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fila de una cita (de hoy, próxima o vencida) con sus acciones. */
function CitaRow({ t, now, actions }) {
  const { patient } = useStore();
  const late = t.state === 'CITADO' && sameDay(t.cita.at, now) && now > t.cita.at + 15 * MIN;
  return (
    <m.li {...listItem} layout className={`qrow ${t.prio === 'CRITICA' ? 'crit' : ''}`}>
      <span className="hour">{fmtHora(t.cita.at)}</span>
      <div className="qmain">
        <span className="who"><TurnCode id={t.id} /> {fullName(patient(t.dni))}</span>
        <span className="meta"><CitaLine c={t.cita} now={now} /></span>
      </div>
      <div className="qside">{t.state === 'CITADO' ? <Badge tone={late ? 'crit' : 'info'}>{late ? 'Atrasado' : 'Por llegar'}</Badge> : <StateBadge state={t.state} />}</div>
      <div className="acts">{actions}</div>
    </m.li>
  );
}

export default function Citas() {
  const { db, run, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [selId, setSelId] = useState(null);
  const [reprog, setReprog] = useState(null);
  const [esp, setEsp] = useState('');
  const pend = db.turns.filter((t) => QUEUE.adm.includes(t.state)).sort(byPriority);
  const sel = pend.find((t) => t.id === selId) || pend[0];
  const hoy = citasDelDia(db.turns, now);
  const citados = db.turns.filter((t) => t.state === 'CITADO').sort((a, b) => a.cita.at - b.cita.at);
  const futuras = citados.filter((t) => startOfDay(t.cita.at) > startOfDay(now));
  const proximas = porDia(futuras.map((t) => ({ at: t.cita.at, t })));
  const vencidas = citados.filter((t) => t.cita.at < startOfDay(now));

  const noAsistio = (t) => ask({
    title: `¿${t.id} no asistió a su cita?`, icon: 'hourglass', danger: true, confirmLabel: 'Cerrar turno',
    text: `La cita de ${fullName(patient(t.dni))} queda como no asistida y el cupo se libera.`,
    onConfirm: () => run(cancelTurn, t.id, CANCEL.noAsistio),
  });
  const anular = (t) => ask({
    title: `Anular la cita de ${t.id}`, danger: true, confirmLabel: 'Anular cita',
    text: `${fullName(patient(t.dni))} pierde la cita y el cupo queda libre. Esta acción no se puede deshacer.`,
    options: [CANCEL.anulado, CANCEL.retiro], onConfirm: (motivo) => run(cancelTurn, t.id, motivo),
  });
  const done = (t) => {
    setSelId(null);
    setReprog(null);
    docs.openCita(t);
  };
  const citadoActs = (t) => (
    <>
      {sameDay(t.cita.at, now) && <button className="btn sm" onClick={() => run(checkIn, t.id)}><LogIn /> Registrar llegada</button>}
      <button className="btn sec sm" onClick={() => setReprog(t)}><CalendarClock /> Reprogramar</button>
      {t.cita.at < now ? <button className="btn dng sm" onClick={() => noAsistio(t)}><UserX /> No asistió</button>
        : <button className="btn dng sm" onClick={() => anular(t)}><Ban /> Anular</button>}
    </>
  );

  return (
    <>
      <WorkspaceHeader title="Citas" icon="calendar" route figs
        lead="Después del triaje, cada paciente saca aquí su cita con el especialista. El sistema la propone según la prioridad y el horario de los médicos; si el especialista no atiende hoy, la cita es otro día." />
      <div className="grid-2 wide-r">
        <Panel title="Por asignar cita" count={pend.length} icon="clipboard" sub="Terminaron el triaje. Los críticos y prioritarios primero.">
          {pend.length ? (
            <ul className="queue">
              <AnimatePresence initial={false}>
                {pend.map((t) => (
                  <m.li key={t.id} {...listItem} layout className={`qrow ${sel?.id === t.id ? 'sel' : ''} ${t.prio === 'CRITICA' ? 'crit' : ''}`}>
                    <TurnCode id={t.id} />
                    <div className="qmain">
                      <span className="who">{fullName(patient(t.dni))}</span>
                      <span className="meta"><span>{t.tri?.motivo}</span><WaitTime turn={t} now={now} /></span>
                    </div>
                    <div className="qside"><PrioBadge prio={t.prio} /></div>
                    <div className="acts"><button className="btn sec sm" onClick={() => setSelId(t.id)} disabled={sel?.id === t.id}>Dar cita</button></div>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="check" title="Nadie espera su cita" />}
        </Panel>
        <Panel title="Asignar cita" icon="calendar">
          <AnimatePresence mode="wait">
            {sel ? (
              <m.div key={sel.id} {...listItem}>
                <CitaForm turn={sel} patient={patient(sel.dni)} onDone={done} />
              </m.div>
            ) : (
              <m.div key="none" {...listItem}>
                <Empty icon="calendar" title="Ningún paciente seleccionado">Cuando Enfermería termina un triaje, el paciente aparece en la lista para darle su cita.</Empty>
              </m.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="Citas de hoy" count={hoy.length} icon="stopwatch" sub="Al llegar el paciente citado, registre su llegada: pasa a la espera de su médico">
          {hoy.length ? (
            <ul className="queue">
              <AnimatePresence initial={false}>
                {hoy.map((t) => <CitaRow key={turnKey(t)} t={t} now={now} actions={t.state === 'CITADO' ? citadoActs(t) : null} />)}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="calendar" title="No hay citas para hoy" />}
        </Panel>
        <Panel title="Próximas citas" count={futuras.length + vencidas.length} icon="calendar" sub="Pacientes que vuelven otro día">
          {vencidas.length > 0 && (
            <>
              <h3 className="h3 day-h">Vencidas sin registrar llegada</h3>
              <ul className="queue">{vencidas.map((t) => <CitaRow key={turnKey(t)} t={t} now={now} actions={citadoActs(t)} />)}</ul>
            </>
          )}
          {proximas.length ? proximas.map(({ day, cupos }) => (
            <section key={day}>
              <h3 className="h3 day-h">{fmtCitaDia(day, now)} <small>{cupos.length} {cupos.length === 1 ? 'cita' : 'citas'}</small></h3>
              <ul className="queue">{cupos.map(({ t }) => <CitaRow key={turnKey(t)} t={t} now={now} actions={citadoActs(t)} />)}</ul>
            </section>
          )) : !vencidas.length && <Empty icon="check" title="No hay citas programadas para los próximos días" />}
        </Panel>
      </div>

      <Panel
        title="Horario de atención"
        icon="calendar"
        sub="Días y horas en que atiende cada médico. Con este horario el sistema calcula los cupos."
        actions={<Segmented label="Especialidad" value={esp} onChange={setEsp} options={[['', 'Todas'], ...ESPECIALIDADES.map((e) => [e.k, e.n])]} />}
      >
        <HorarioSemanal esp={esp || null} />
      </Panel>

      <AnimatePresence>
        {reprog && (
          <Modal key="reprog" label={`Reprogramar la cita de ${reprog.id}`} onClose={() => setReprog(null)}>
            <h3>Reprogramar la cita de {reprog.id}</h3>
            <CitaForm turn={reprog} patient={patient(reprog.dni)} onDone={done} />
          </Modal>
        )}
      </AnimatePresence>
      {docs.element}
      {dialog}
    </>
  );
}
