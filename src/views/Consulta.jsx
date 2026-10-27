import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { FileText, FolderOpen, Megaphone, PhoneCall, Play, Plus, Repeat, Send, Trash2, Undo2, UserX } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { callTurn, callNext, startConsult, finishConsult, returnToQueue, cancelTurn, changeArea } from '../store/actions.js';
import { allergyConflicts, byConsulta, evalTriage, prioColor, turnKey } from '../lib/clinical.js';
import { agendaPublica, citasDelDia, cuposLibres, especialidad } from '../lib/agenda.js';
import { AREAS, CANCEL, DAY, DESTINOS, MEDS, QUEUE } from '../lib/constants.js';
import { age, cap, fmtCitaDia, fmtLongDay, fmtT, fmtHora, fullName, saludo, startOfDay, startOfToday } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { usePatientHistory } from '../hooks/usePatientHistory.js';
import { Help } from '../components/WorkspaceHeader.jsx';
import { SectionHero } from '../components/SectionHero.jsx';
import { PacCard, Siguiente } from '../components/Cola.jsx';
import { Badge, Empty, Field, Msg, Panel, PrioBadge, Segmented, SisBadge, StateBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { noShowDialog, useConfirm } from '../hooks/useConfirm.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { CiePicker } from '../components/CiePicker.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { PatientTimeline } from '../components/PatientTimeline.jsx';
import '../components/charts/charts.css';
import './workspaces.css';

const emptyMed = () => ({ key: Math.random().toString(36).slice(2), n: '', dosis: '', frec: '', dias: '', cant: '' });
const RECIPES_SHOWN = 8;
const DEST_ICON = { Alta: 'house', 'Reposo médico': 'bed', 'Derivación a hospital': 'ambulance' };
const VITAL_ROWS = [['pa', 'PA', (t) => `${t.pa} mmHg`, 'heart'], ['fc', 'FC', (t) => `${t.fc} lpm`, 'stopwatch'], ['fr', 'FR', (t) => `${t.fr} rpm`, 'lungs'], ['t', 'Temp.', (t) => `${t.t} °C`, 'thermometer'], ['spo2', 'SpO₂', (t) => `${t.spo2} %`, 'blood']];

/** Signos del triaje, cada uno con su estado frente a los umbrales vigentes. */
function Vitals({ tri, th }) {
  const r = evalTriage(tri, th);
  return (
    <div className="vread">
      {VITAL_ROWS.map(([k, label, fmt, icon]) => (
        <div key={k} className={`vr ${r.status[k] && r.status[k] !== 'ok' ? `v-${r.status[k]}` : ''}`}>
          <Icon3D name={icon} size={24} />
          <span>{label}</span>
          <b>{fmt(tri)}</b>
        </div>
      ))}
      <div className="vr"><span>Peso y talla</span><b>{tri.peso} kg, {tri.talla} m</b></div>
      <div className="vr"><span>IMC</span><b>{r.imc}</b></div>
    </div>
  );
}

function PatientSummary({ turn, patient, docs }) {
  const { th } = useStore();
  const hist = usePatientHistory(patient.dni);
  const prev = hist.attended;
  return (
    <Panel title="Paciente en consulta" icon="folder" className="ws-panel" data-role="med">
      <div className="patient-card">
        <TurnCode id={turn.id} className="big" />
        <div className="pc-main">
          <b>{fullName(patient)}</b>
          <small>{age(patient.nac)} años, DNI {patient.dni}, {patient.hc}</small>
        </div>
        <div className="pc-badges"><PrioBadge prio={turn.prio} /><SisBadge sis={patient.sis} /></div>
      </div>
      {patient.alg ? <Msg tone="crit"><b>Alergia:</b> {patient.alg}</Msg> : <p className="note">Sin alergias conocidas.</p>}
      {patient.ant && <p className="note"><b>Antecedentes:</b> {patient.ant}</p>}
      {turn.cita && (
        <p className="note">
          Cita de {especialidad(turn.cita.esp)?.n} a las <b>{fmtHora(turn.cita.at)}</b>{turn.cita.sobre ? ' (sobrecupo por prioridad crítica)' : ''}
          {startOfDay(turn.t0) !== startOfDay(turn.cita.at) && `; triaje del ${fmtCitaDia(turn.tTriSave ?? turn.t0)}`}.
        </p>
      )}
      <h3 className="h3">Triaje: {turn.tri.motivo}</h3>
      <Vitals tri={turn.tri} th={th} />
      <h3 className="h3">Atenciones anteriores ({prev.length})</h3>
      <PatientTimeline visits={prev.slice(0, 3)} loading={hist.loading} onRecipe={docs.openRecipe} />
      <button className="btn sec sm" onClick={() => docs.openHC(patient.dni)}><FolderOpen /> Historia clínica completa</button>
    </Panel>
  );
}

/** Plazos habituales para el próximo control. */
const PLAZOS = [[7, 'En 1 semana'], [15, 'En 15 días'], [30, 'En 1 mes']];
const CONTROL_OPCIONES = 6;

/**
 * Próximo control: el médico deja agendada la siguiente cita del paciente con él mismo. Se proponen sus
 * primeros cupos libres desde el plazo elegido; la cita se reserva al cerrar la atención (la base revalida).
 */
function ProximoControl({ ctl, setCtl, opciones, elegido, cargando, err }) {
  return (
    <fieldset className="dest control">
      <legend>Próximo control</legend>
      <label className="check">
        <input type="checkbox" checked={ctl.on} onChange={(e) => setCtl((c) => ({ ...c, on: e.target.checked, pick: null }))} />
        Dejar agendado un control con usted
      </label>
      {ctl.on && (
        <div className="stack">
          <div className="chips" role="group" aria-label="Plazo del control">
            {PLAZOS.map(([d, n]) => (
              <button key={d} type="button" className="chip" aria-pressed={ctl.plazo === d} onClick={() => setCtl((c) => ({ ...c, plazo: d, pick: null }))}>{n}</button>
            ))}
          </div>
          {err ? <Msg tone="crit">{err}</Msg> : cargando ? <p className="note">Buscando sus cupos libres…</p> : opciones.length ? (
            <div className="ctl-slots" role="radiogroup" aria-label="Cupo del control">
              {opciones.map((o) => (
                <button
                  key={o.at}
                  type="button"
                  role="radio"
                  className="ctl-slot"
                  aria-checked={elegido?.at === o.at}
                  onClick={() => setCtl((c) => ({ ...c, pick: o }))}
                >
                  <b>{fmtHora(o.at)}</b>
                  <span>{cap(fmtCitaDia(o.at))}</span>
                  <small>{o.area}</small>
                </button>
              ))}
            </div>
          ) : <Msg tone="warn">No tiene cupos libres desde esa fecha en su horario. Elija un plazo menor.</Msg>}
        </div>
      )}
    </fieldset>
  );
}

function ConsultForm({ turn, patient, onDone }) {
  const { run, th, repo, user, toast, reload } = useStore();
  const now = useNow(60_000);
  const [notas, setNotas] = useState('');
  const [dx, setDx] = useState([]);
  const [meds, setMeds] = useState([emptyMed()]);
  const [dest, setDest] = useState(DESTINOS[0]);
  const [destx, setDestx] = useState('');
  const [override, setOverride] = useState(false);
  const [ctl, setCtl] = useState({ on: false, plazo: 7, pick: null });
  const [agenda, setAgenda] = useState(null);
  const [agendaErr, setAgendaErr] = useState('');
  const esp = turn.cita?.esp ?? user.esp;
  const crit = evalTriage(turn.tri, th).c;
  const conflicts = allergyConflicts(patient.alg, meds.map((x) => x.n));
  const setMed = (key, k) => (e) => setMeds((ms) => ms.map((x) => (x.key === key ? { ...x, [k]: e.target.value } : x)));

  // Los cupos del médico se piden recién cuando decide agendar un control
  useEffect(() => {
    if (!ctl.on || agenda || !esp) return undefined;
    let vivo = true;
    repo.cupos(esp).then((c) => vivo && setAgenda(agendaPublica(c)), (e) => vivo && setAgendaErr(e.message));
    return () => { vivo = false; };
  }, [ctl.on, agenda, esp, repo]);
  const desde = startOfDay(now) + ctl.plazo * DAY;
  const opciones = agenda ? cuposLibres(agenda, esp, now, { med: user.u }).filter((c) => c.at >= desde).slice(0, CONTROL_OPCIONES) : [];
  const conControl = ctl.on && dest !== 'Derivación a hospital';
  const control = conControl ? ctl.pick ?? opciones[0] ?? null : null;

  const submit = async (e) => {
    e.preventDefault();
    if (conControl && !control) return toast('crit', 'Elija un cupo para el próximo control o desmarque la opción.');
    const r = await run(finishConsult, turn.id, { notas, dx, meds: meds.map(({ key: _k, ...x }) => x), dest, destx, allergyOverride: override });
    if (!r.ok) return undefined;
    if (control) {
      try {
        await repo.reservarCita(patient.dni, patient.nac, { esp, med: control.med, at: control.at });
        toast('ok', `Próximo control agendado: ${fmtLongDay(control.at)} a las ${fmtHora(control.at)} (${control.area}).`);
        reload?.();
      } catch (err) {
        toast('crit', `La atención se cerró, pero el control no se pudo agendar: ${err.message} Pídalo en Admisión.`);
      }
    }
    return onDone(r.result);
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      {crit.length > 0 && <Msg tone="crit"><b>Alerta crítica de triaje:</b> {crit.join(', ')}.</Msg>}
      <Field label="Anamnesis y examen clínico">
        {(a) => <textarea {...a} value={notas} onChange={(e) => setNotas(e.target.value)} rows={4} placeholder="Relato del paciente, examen físico y hallazgos" />}
      </Field>
      <CiePicker value={dx} onChange={setDx} />

      <div className="field">
        <label>Receta</label>
        <datalist id="meds-l">{MEDS.map((x) => <option key={x.n} value={x.n} />)}</datalist>
        <ul className="meds">
          <AnimatePresence initial={false}>
            {meds.map((x, i) => (
              <m.li className="medrow" key={x.key} {...listItem} layout>
                <input list="meds-l" placeholder="Medicamento y concentración" aria-label={`Medicamento ${i + 1}`} value={x.n} onChange={setMed(x.key, 'n')} />
                <input placeholder="Dosis" aria-label="Dosis" value={x.dosis} onChange={setMed(x.key, 'dosis')} />
                <input placeholder="Frecuencia" aria-label="Frecuencia" value={x.frec} onChange={setMed(x.key, 'frec')} />
                <input type="number" min="1" placeholder="Días" aria-label="Duración en días" value={x.dias} onChange={setMed(x.key, 'dias')} />
                <input type="number" min="1" placeholder="Cant." aria-label="Cantidad" value={x.cant} onChange={setMed(x.key, 'cant')} />
                <button type="button" className="icon-btn sm" aria-label={`Quitar medicamento ${i + 1}`} onClick={() => setMeds((ms) => (ms.length > 1 ? ms.filter((y) => y.key !== x.key) : [emptyMed()]))}><Trash2 /></button>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
        {meds.length < 6 && <button type="button" className="btn ghost sm add-med" onClick={() => setMeds((ms) => [...ms, emptyMed()])}><Plus /> Agregar medicamento</button>}
      </div>

      {conflicts.length > 0 && (
        <Msg tone="crit">
          <b>Posible reacción alérgica.</b> El paciente registra alergia a «{patient.alg}» y se indicó: {conflicts.map((c) => c.med).join(', ')}.
          <label className="check">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Confirmo la prescripción bajo mi responsabilidad (queda en auditoría)
          </label>
        </Msg>
      )}

      <fieldset className="dest">
        <legend>Destino del paciente</legend>
        <div className="dest-opts">
          {DESTINOS.map((d) => (
            <label key={d} className={`dest-opt ${dest === d ? 'on' : ''}`}>
              <input type="radio" name={`dest-${turn.id}`} value={d} checked={dest === d} onChange={() => { setDest(d); setDestx(''); }} />
              <Icon3D name={DEST_ICON[d]} size={32} />
              <span>{d}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {dest === 'Reposo médico' && (
        <Field label="Días de reposo">{(a) => <input {...a} type="number" min="1" max="30" value={destx} onChange={(e) => setDestx(e.target.value)} />}</Field>
      )}
      {dest === 'Derivación a hospital' && (
        <Field label="Establecimiento de destino">{(a) => <input {...a} value={destx} onChange={(e) => setDestx(e.target.value)} placeholder="Hospital Regional (demo)" />}</Field>
      )}
      {dest !== 'Derivación a hospital' && esp && (
        <ProximoControl ctl={ctl} setCtl={setCtl} opciones={opciones} elegido={control} cargando={ctl.on && !agenda && !agendaErr} err={agendaErr} />
      )}
      <div className="actions">
        <button className="btn lg"><Send /> Finalizar atención y emitir receta{control ? ' con control' : ''}</button>
        <button type="button" className="btn ghost" onClick={() => run(returnToQueue, turn.id)}><Undo2 /> Devolver a la lista</button>
      </div>
    </form>
  );
}

/** «Dra. Elena Ríos (demo)» → «Dra. Elena»: el saludo lleva el tratamiento y el primer nombre. */
const nombreCorto = (n) => {
  const [, trato = '', resto = n] = n.match(/^(Dra?\.\s*)?(.*)$/) ?? [];
  return `${trato}${resto.split(' ')[0]}`;
};

function RecetasHoy({ today, allRec, setAllRec, docs, pat }) {
  return (
    <Panel title="Recetas emitidas hoy" count={today.length} icon="pill" className="ws-panel" data-role="med">
      {today.length ? (
        <ul className="queue">
          {(allRec ? today : today.slice(0, RECIPES_SHOWN)).map((t) => (
            <li className="qrow" key={t.id}>
              <TurnCode id={t.id} />
              <div className="qmain">
                <span className="who">{fullName(pat(t))}</span>
                <span className="meta"><span className="code">{t.consult.rec}</span><span>{fmtT(t.consult.t)}</span><span>{t.consult.dest}</span><span>{t.consult.medico?.n}</span></span>
              </div>
              <div className="qside"><button className="btn sec sm" onClick={() => docs.openRecipe(t)}><FileText /> Ver receta</button></div>
            </li>
          ))}
        </ul>
      ) : <Empty icon="pill" title="Aún no hay recetas hoy" />}
      {today.length > RECIPES_SHOWN && (
        <button className="btn ghost sm" onClick={() => setAllRec((v) => !v)}>
          {allRec ? 'Mostrar menos' : `Mostrar las ${today.length} recetas`}
        </button>
      )}
    </Panel>
  );
}

export default function Consulta() {
  const { db, run, area, updatePrefs, patient, user } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [allRec, setAllRec] = useState(false);
  const [ver, setVer] = useState('espera');
  const pat = (t) => patient(t.dni);
  // El médico ve solo a los pacientes que tienen cita con él y ya llegaron, por prioridad y hora de la cita
  const mine = (t) => !t.cita || t.cita.med === user.u;
  const queue = db.turns.filter((t) => [...QUEUE.med, 'EN_CONSULTA'].includes(t.state) && t.tri && mine(t)).sort(byConsulta);
  const agenda = citasDelDia(db.turns, now, user.u);
  const proximas = db.turns.filter((t) => t.state === 'CITADO' && t.cita.med === user.u && t.cita.at >= startOfDay(now) + DAY).length;
  const current = db.turns.find((t) => t.state === 'EN_CONSULTA' && t.dest === area);
  const today = db.turns.filter((t) => t.consult && t.consult.t >= startOfToday()).sort((a, b) => b.consult.t - a.consult.t);
  const esperan = queue.filter((t) => t.state === 'EN_ESPERA_CONSULTA');
  const llamadoAqui = queue.find((t) => t.state === 'LLAMADO_CONSULTA' && t.dest === area);
  const tiles = [
    { k: 'espera', n: 'En espera', icon: 'hourglass', c: 'med', value: esperan.length },
    { k: 'urg', n: 'Críticos o prioritarios', icon: 'warning', c: 'crit', value: esperan.filter((t) => t.prio !== 'NORMAL').length },
    { k: 'llegan', n: 'Citados por llegar hoy', icon: 'calendar', c: 'adm', value: agenda.filter((t) => t.state === 'CITADO').length },
    { k: 'hechos', n: 'Atendidos hoy', icon: 'check', c: 'good', value: today.filter((t) => t.consult.medico?.u === user.u).length },
  ];

  const setArea = async (a) => {
    const r = await run(changeArea, a);
    if (r.ok) updatePrefs({ area: a });
  };
  const noShow = (t) => ask(noShowDialog(t, 'El turno se cerrará sin atención médica.', () => run(cancelTurn, t.id, CANCEL.noShow)));
  const llamadoActs = (t, big = false) => (
    <>
      <button className={`btn ${big ? '' : 'sm'}`} onClick={() => run(startConsult, t.id)} disabled={!!current}><Play /> Iniciar atención</button>
      {big ? (
        <>
          <button type="button" className="btn sec sm" onClick={() => run(callTurn, t.id)}><Repeat /> Volver a llamar</button>
          <button type="button" className="btn ghost sm dng-txt" onClick={() => noShow(t)}><UserX /> No se presentó</button>
        </>
      ) : (
        <span className="row-icons">
          <button type="button" className="icon-btn sm" onClick={() => run(callTurn, t.id)} aria-label={`Volver a llamar a ${t.id}`} title="Volver a llamar"><Repeat /></button>
          <button type="button" className="icon-btn sm dng" onClick={() => noShow(t)} aria-label={`${t.id} no se presentó`} title="No se presentó"><UserX /></button>
        </span>
      )}
    </>
  );
  const actions = (t) => {
    if (t.state === 'EN_ESPERA_CONSULTA') return <button className="btn sec sm" onClick={() => run(callTurn, t.id)} disabled={!!current}><PhoneCall /> Llamar</button>;
    if (t.state === 'EN_CONSULTA') return <Badge tone="warn">En {t.dest}</Badge>;
    if (t.dest !== area) return <Badge tone="info">Llamado a {t.dest}</Badge>;
    return llamadoActs(t);
  };
  const detalle = (t) => (
    <>
      {t.cita && <span>cita {fmtHora(t.cita.at)}{t.cita.sobre ? ' (sobrecupo)' : ''}</span>}
      <WaitTime turn={t} now={now} />
    </>
  );
  const sigue = esperan[0];
  const recetas = <RecetasHoy today={today} allRec={allRec} setAllRec={setAllRec} docs={docs} pat={pat} />;

  return (
    <>
      <SectionHero
        icon="stethoscope"
        kicker={`${area} · ${cap(fmtLongDay(now))} · ${fmtT(now)}`}
        title={`${saludo(now)}, ${nombreCorto(user.n)}`}
        text={current
          ? `Atiende a ${fullName(pat(current))}. Al finalizar se emite la receta y puede dejarle agendado su próximo control.`
          : 'Sus pacientes con cita que ya pasaron por triaje, en orden de prioridad clínica y hora de la cita.'}
        tiles={tiles}
        label="Resumen de su consulta"
        actions={
          <>
            <select aria-label="Consultorio" value={area} onChange={(e) => setArea(e.target.value)}>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
            <Help role="med" />
          </>
        }
      />
      <AnimatePresence>
        {current && (
          <m.div key={current.id} {...listItem} className="grid-2 consult">
            <PatientSummary turn={current} patient={pat(current)} docs={docs} />
            <Panel title={`Atención en curso en ${area}`} icon="stethoscope" className="ws-panel" data-role="med">
              <ConsultForm key={current.id} turn={current} patient={pat(current)} onDone={docs.openRecipe} />
            </Panel>
          </m.div>
        )}
      </AnimatePresence>

      <div className="grid-2 ws-grid">
        <Panel
          title={ver === 'espera' ? 'Lista de espera' : 'Mi agenda de hoy'}
          count={ver === 'espera' ? queue.filter((t) => t.state !== 'EN_CONSULTA').length : agenda.length}
          icon="clipboard"
          sub={ver === 'espera' ? 'El color es la prioridad del triaje: rojo crítica, ámbar prioritaria, verde normal.'
            : `Todas sus citas de hoy${proximas ? `; tiene ${proximas} más en los próximos días` : ''}`}
          className="ws-panel"
          data-role="med"
          actions={<Segmented label="Ver" value={ver} onChange={setVer} options={[['espera', 'En espera'], ['agenda', 'Agenda', agenda.length]]} />}
        >
          {ver === 'agenda' ? (
            agenda.length ? (
              <ul className="pacs">
                {agenda.map((t) => (
                  <PacCard
                    key={turnKey(t)}
                    turn={t}
                    patient={pat(t)}
                    c={t.state === 'CITADO' ? 'var(--line-strong)' : prioColor(t.prio)}
                    tag={fmtHora(t.cita.at)}
                    note={t.tri?.motivo}
                    badge={t.state === 'CITADO' ? <Badge tone="info">Por llegar</Badge> : <StateBadge state={t.state} />}
                  />
                ))}
              </ul>
            ) : <Empty icon="calendar" title="No tiene citas hoy" />
          ) : queue.length ? (
            <ul className="pacs">
              <AnimatePresence initial={false}>
                {queue.map((t) => (
                  <PacCard
                    key={t.id}
                    turn={t}
                    patient={pat(t)}
                    c={prioColor(t.prio)}
                    on={t.state !== 'EN_ESPERA_CONSULTA' && t.dest === area}
                    meta={detalle(t)}
                    note={t.tri.motivo}
                    badge={<PrioBadge prio={t.prio} />}
                    actions={actions(t)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="check" title="No hay pacientes en espera de consulta">Aparecen aquí cuando un paciente con cita con usted termina su triaje.</Empty>}
        </Panel>

        {current ? recetas : (
          <Panel title="Ahora" icon="stethoscope" className="ws-panel" data-role="med">
            <AnimatePresence mode="wait">
              {llamadoAqui ? (
                <m.div key={`l-${llamadoAqui.id}`} {...listItem} className="ahora">
                  <Siguiente kicker={`Llamado a ${area}: espere a que entre`} turn={llamadoAqui} patient={pat(llamadoAqui)} c={prioColor(llamadoAqui.prio)} detail={detalle(llamadoAqui)} action={llamadoActs(llamadoAqui, true)} />
                  <p className="ahora-note">Motivo del triaje: {llamadoAqui.tri.motivo}. Al iniciar la atención se abren su historia y el formulario de la consulta.</p>
                </m.div>
              ) : sigue ? (
                <m.div key={`s-${sigue.id}`} {...listItem} className="ahora">
                  <Siguiente
                    turn={sigue}
                    patient={pat(sigue)}
                    c={prioColor(sigue.prio)}
                    detail={<><PrioBadge prio={sigue.prio} />{detalle(sigue)}</>}
                    action={<button className="btn lg" onClick={() => run(callNext, 'med', byConsulta)}><Megaphone /> Llamar siguiente</button>}
                  />
                  <p className="ahora-note">Motivo: {sigue.tri.motivo}. Su turno aparecerá en la pantalla de la sala con el número de {area}.</p>
                </m.div>
              ) : (
                <m.div key="none" {...listItem}>
                  <Empty icon="stethoscope" title="Nadie esperando consulta">
                    {agenda.some((t) => t.state === 'CITADO') ? 'Tiene citados que aún no llegan: aparecerán aquí al pasar por triaje.' : 'No le quedan citas por atender hoy.'}
                  </Empty>
                </m.div>
              )}
            </AnimatePresence>
          </Panel>
        )}
      </div>
      {!current && recetas}
      {docs.element}
      {dialog}
    </>
  );
}
