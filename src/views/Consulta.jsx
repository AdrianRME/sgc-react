import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { FileText, FolderOpen, Megaphone, PhoneCall, Play, Plus, Repeat, Send, Trash2, Undo2, UserX } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { callTurn, callNext, startConsult, finishConsult, returnToQueue, cancelTurn, changeArea } from '../store/actions.js';
import { allergyConflicts, byPriority, evalTriage } from '../lib/clinical.js';
import { AREAS, CANCEL, DESTINOS, MEDS, QUEUE } from '../lib/constants.js';
import { age, fmtT, fullName, startOfToday } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { usePatientHistory } from '../hooks/usePatientHistory.js';
import { WorkspaceHeader } from '../components/WorkspaceHeader.jsx';
import { Badge, Empty, Field, Msg, Panel, PrioBadge, SisBadge, TurnCode, WaitTime } from '../components/ui.jsx';
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
    <Panel title="Paciente en consulta" icon="folder">
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
      <h3 className="h3">Triaje: {turn.tri.motivo}</h3>
      <Vitals tri={turn.tri} th={th} />
      <h3 className="h3">Atenciones anteriores ({prev.length})</h3>
      <PatientTimeline visits={prev.slice(0, 3)} loading={hist.loading} onRecipe={docs.openRecipe} />
      <button className="btn sec sm" onClick={() => docs.openHC(patient.dni)}><FolderOpen /> Historia clínica completa</button>
    </Panel>
  );
}

function ConsultForm({ turn, patient, onDone }) {
  const { run, th } = useStore();
  const [notas, setNotas] = useState('');
  const [dx, setDx] = useState([]);
  const [meds, setMeds] = useState([emptyMed()]);
  const [dest, setDest] = useState(DESTINOS[0]);
  const [destx, setDestx] = useState('');
  const [override, setOverride] = useState(false);
  const crit = evalTriage(turn.tri, th).c;
  const conflicts = allergyConflicts(patient.alg, meds.map((x) => x.n));
  const setMed = (key, k) => (e) => setMeds((ms) => ms.map((x) => (x.key === key ? { ...x, [k]: e.target.value } : x)));

  const submit = async (e) => {
    e.preventDefault();
    const r = await run(finishConsult, turn.id, { notas, dx, meds: meds.map(({ key: _k, ...x }) => x), dest, destx, allergyOverride: override });
    if (r.ok) onDone(r.result);
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
      <div className="actions">
        <button className="btn lg"><Send /> Finalizar atención y emitir receta</button>
        <button type="button" className="btn ghost" onClick={() => run(returnToQueue, turn.id)}><Undo2 /> Devolver a la lista</button>
      </div>
    </form>
  );
}

export default function Consulta() {
  const { db, run, area, updatePrefs, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [allRec, setAllRec] = useState(false);
  const pat = (t) => patient(t.dni);
  const queue = db.turns.filter((t) => [...QUEUE.med, 'EN_CONSULTA'].includes(t.state) && t.tri).sort(byPriority);
  const current = db.turns.find((t) => t.state === 'EN_CONSULTA' && t.dest === area);
  const today = db.turns.filter((t) => t.consult && t.consult.t >= startOfToday()).sort((a, b) => b.consult.t - a.consult.t);

  const setArea = async (a) => {
    const r = await run(changeArea, a);
    if (r.ok) updatePrefs({ area: a });
  };
  const noShow = (t) => ask(noShowDialog(t, 'El turno se cerrará sin atención médica.', () => run(cancelTurn, t.id, CANCEL.noShow)));
  const actions = (t) => {
    if (t.state === 'EN_ESPERA_CONSULTA') return <button className="btn sec sm" onClick={() => run(callTurn, t.id)}><PhoneCall /> Llamar</button>;
    if (t.state === 'EN_CONSULTA') return <Badge tone="warn">En {t.dest}</Badge>;
    if (t.dest !== area) return <Badge tone="info">Llamado a {t.dest}</Badge>;
    return (
      <>
        <button className="btn sm" onClick={() => run(startConsult, t.id)} disabled={!!current}><Play /> Iniciar atención</button>
        <button className="btn sec sm" onClick={() => run(callTurn, t.id)}><Repeat /> Repetir</button>
        <button className="btn dng sm" onClick={() => noShow(t)}><UserX /> No se presentó</button>
      </>
    );
  };

  return (
    <>
      <WorkspaceHeader title="Mis pacientes" route figs />
      <AnimatePresence>
        {current && (
          <m.div key={current.id} {...listItem} className="grid-2 consult">
            <PatientSummary turn={current} patient={pat(current)} docs={docs} />
            <Panel title={`Atención en curso en ${area}`} icon="stethoscope">
              <ConsultForm key={current.id} turn={current} patient={pat(current)} onDone={docs.openRecipe} />
            </Panel>
          </m.div>
        )}
      </AnimatePresence>

      <div className="grid-2 wide-r">
        <Panel
          title="Lista de espera"
          count={queue.filter((t) => t.state !== 'EN_CONSULTA').length}
          icon="clipboard"
          sub="Ordenada por prioridad clínica y hora de llegada"
          actions={
            <>
              <select aria-label="Consultorio" className="input sm-select" value={area} onChange={(e) => setArea(e.target.value)}>
                {AREAS.map((a) => <option key={a}>{a}</option>)}
              </select>
              {!current && queue.some((t) => t.state === 'EN_ESPERA_CONSULTA') && (
                <button className="btn sm" onClick={() => run(callNext, 'med', byPriority)}><Megaphone /> Llamar siguiente</button>
              )}
            </>
          }
        >
          {queue.length ? (
            <ul className="queue">
              <AnimatePresence initial={false}>
                {queue.map((t) => (
                  <m.li key={t.id} {...listItem} layout className={`qrow ${t.state === 'LLAMADO_CONSULTA' && t.dest === area ? 'sel' : ''} ${t.prio === 'CRITICA' ? 'crit' : ''}`}>
                    <TurnCode id={t.id} />
                    <div className="qmain">
                      <span className="who">{fullName(pat(t))}</span>
                      <span className="meta"><span>{t.tri.motivo}</span><WaitTime turn={t} now={now} /></span>
                    </div>
                    <div className="qside"><PrioBadge prio={t.prio} /></div>
                    <div className="acts">{actions(t)}</div>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="check" title="No hay pacientes en espera de consulta" />}
        </Panel>
        <Panel title="Recetas emitidas hoy" count={today.length} icon="pill">
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
      </div>
      {docs.element}
      {dialog}
    </>
  );
}
