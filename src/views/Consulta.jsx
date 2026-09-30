import { useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { callTurn, callNext, startConsult, finishConsult, returnToQueue, cancelTurn, changeArea } from '../store/actions.js';
import { allergyConflicts, byPriority, evalTriage } from '../lib/clinical.js';
import { AREAS, DESTINOS, MEDS } from '../lib/constants.js';
import { age, fmtD, fmtT, fullName, startOfToday } from '../lib/format.js';
import { Badge, Card, Code, Empty, Field, Msg, PrioBadge, SisBadge, WaitTime, useConfirm } from '../components/ui.jsx';
import { CiePicker } from '../components/CiePicker.jsx';
import { useDocuments } from '../components/Documents.jsx';
import { useNow } from '../hooks/useNow.js';

const emptyMed = () => ({ n: '', dosis: '', frec: '', dias: '', cant: '' });

function Vitals({ tri, th }) {
  const r = evalTriage(tri, th);
  const row = (k, label, val) => (
    <><span>{label}</span><b className={r.status[k] && r.status[k] !== 'ok' ? `vb ${r.status[k]}` : ''}>{val}</b></>
  );
  return (
    <div className="vit">
      {row('pa', 'PA', tri.pa)}
      {row('fc', 'FC', `${tri.fc} lpm`)}
      {row('fr', 'FR', `${tri.fr} rpm`)}
      {row('t', 'Temp.', `${tri.t} °C`)}
      {row('spo2', 'SpO₂', `${tri.spo2} %`)}
      <span>Peso / talla</span><b>{tri.peso} kg / {tri.talla} m</b>
      <span>IMC</span><b>{r.imc}</b>
    </div>
  );
}

function PatientSummary({ turn, patient, onHC }) {
  const { db, th } = useStore();
  const hist = db.turns.filter((t) => t.dni === patient.dni && t.consult).sort((a, b) => b.consult.t - a.consult.t);
  return (
    <Card>
      <div className="patient-head">
        <div>
          <b>{fullName(patient)}</b>
          <small>{age(patient.nac)} años · DNI {patient.dni} · {patient.hc}</small>
        </div>
        <SisBadge sis={patient.sis} />
      </div>
      <div className="inline"><PrioBadge prio={turn.prio} /> <Code>{turn.id}</Code></div>
      {patient.alg ? <Msg tone="crit"><b>Alergia:</b> {patient.alg}</Msg> : <p className="note">Sin alergias conocidas.</p>}
      {patient.ant && <p className="note"><b>Antecedentes:</b> {patient.ant}</p>}
      <h3 className="h3">Signos vitales (triaje)</h3>
      <Vitals tri={turn.tri} th={th} />
      <p className="note"><b>Motivo:</b> {turn.tri.motivo}</p>
      <h3 className="h3">Historial ({hist.length})</h3>
      {hist.length ? hist.slice(0, 4).map((t) => (
        <p className="note" key={t.id}>
          <b>{fmtD(t.consult.t)}</b> · {t.consult.dx.map((d) => d[0]).join(', ')}
          <br />{t.consult.meds.map((m) => m.n).join(', ') || 'Sin medicación'}
        </p>
      )) : <p className="note">Primera atención registrada.</p>}
      <button className="btn sec sm" onClick={onHC}>Historia clínica completa</button>
    </Card>
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
  const conflicts = allergyConflicts(patient.alg, meds.map((m) => m.n));

  const setMed = (i, k) => (e) => setMeds((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: e.target.value } : m)));

  const submit = async (e) => {
    e.preventDefault();
    const r = await run(finishConsult, turn.id, { notas, dx, meds, dest, destx, allergyOverride: override });
    if (r.ok) onDone(r.result);
  };

  return (
    <form onSubmit={submit} noValidate>
      {crit.length > 0 && <Msg tone="crit"><b>Alerta crítica de triaje:</b> {crit.join('; ')}</Msg>}
      <Field label="Anamnesis y examen clínico">
        {(a) => <textarea {...a} value={notas} onChange={(e) => setNotas(e.target.value)} rows={4} />}
      </Field>
      <CiePicker value={dx} onChange={setDx} />

      <div className="field">
        <label>Receta</label>
        <datalist id="meds-l">{MEDS.map((m) => <option key={m.n} value={m.n} />)}</datalist>
        <div className="meds">
          {meds.map((m, i) => (
            <div className="medrow" key={i}>
              <input list="meds-l" placeholder="Medicamento y concentración" aria-label={`Medicamento ${i + 1}`} value={m.n} onChange={setMed(i, 'n')} />
              <input placeholder="Dosis" aria-label="Dosis" value={m.dosis} onChange={setMed(i, 'dosis')} />
              <input placeholder="Frecuencia" aria-label="Frecuencia" value={m.frec} onChange={setMed(i, 'frec')} />
              <input type="number" min="1" placeholder="Días" aria-label="Duración en días" value={m.dias} onChange={setMed(i, 'dias')} />
              <input type="number" min="1" placeholder="Cant." aria-label="Cantidad" value={m.cant} onChange={setMed(i, 'cant')} />
              <button type="button" className="icon-btn" aria-label={`Quitar medicamento ${i + 1}`} onClick={() => setMeds((ms) => (ms.length > 1 ? ms.filter((_, j) => j !== i) : [emptyMed()]))}>×</button>
            </div>
          ))}
        </div>
        {meds.length < 6 && <button type="button" className="btn ghost sm" onClick={() => setMeds((ms) => [...ms, emptyMed()])}>+ Agregar medicamento</button>}
      </div>

      {conflicts.length > 0 && (
        <Msg tone="crit">
          <b>Posible reacción alérgica.</b> El paciente registra alergia a «{patient.alg}» y se indicó:{' '}
          {conflicts.map((c) => c.med).join(', ')}.
          <label className="check">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Confirmo la prescripción bajo mi responsabilidad (queda en auditoría)
          </label>
        </Msg>
      )}

      <div className="row">
        <Field label="Destino del paciente">
          {(a) => (
            <select {...a} value={dest} onChange={(e) => { setDest(e.target.value); setDestx(''); }}>
              {DESTINOS.map((d) => <option key={d}>{d}</option>)}
            </select>
          )}
        </Field>
        {dest === 'Reposo médico' && (
          <Field label="Días de reposo">
            {(a) => <input {...a} type="number" min="1" max="30" value={destx} onChange={(e) => setDestx(e.target.value)} />}
          </Field>
        )}
        {dest === 'Derivación a hospital' && (
          <Field label="Establecimiento de destino">
            {(a) => <input {...a} value={destx} onChange={(e) => setDestx(e.target.value)} placeholder="Hospital Regional (demo)" />}
          </Field>
        )}
      </div>
      <div className="actions">
        <button className="btn">Finalizar atención y emitir receta</button>
        <button type="button" className="btn ghost" onClick={() => run(returnToQueue, turn.id)}>Devolver a la lista</button>
      </div>
    </form>
  );
}

export function Consulta() {
  const { db, run, area, updateSession } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const pat = (t) => db.patients.find((p) => p.dni === t.dni);

  const queue = db.turns.filter((t) => ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'].includes(t.state) && t.tri).sort(byPriority);
  const current = db.turns.find((t) => t.state === 'EN_CONSULTA' && t.dest === area);
  const today = db.turns.filter((t) => t.consult && t.consult.t >= startOfToday()).sort((a, b) => b.consult.t - a.consult.t);

  const setArea = async (a) => {
    const r = await run(changeArea, a);
    if (r.ok) updateSession({ area: a });
  };

  const noShow = (t) =>
    ask({
      title: `¿${t.id} no se presentó?`,
      text: 'El turno se cerrará sin atención médica.',
      confirmLabel: 'Cerrar turno',
      danger: true,
      onConfirm: () => run(cancelTurn, t.id, 'No se presentó al llamado'),
    });

  const actions = (t) => {
    if (t.state === 'EN_ESPERA_CONSULTA') return <button className="btn sec sm" onClick={() => run(callTurn, t.id)}>Llamar</button>;
    if (t.state === 'EN_CONSULTA') return <Badge tone="warn">En {t.dest}</Badge>;
    if (t.dest !== area) return <Badge tone="info">Llamado a {t.dest}</Badge>;
    return (
      <>
        <button className="btn sm" onClick={() => run(startConsult, t.id)} disabled={!!current}>Iniciar atención</button>
        <button className="btn sec sm" onClick={() => run(callTurn, t.id)}>Repetir</button>
        <button className="btn dng sm" onClick={() => noShow(t)}>No se presentó</button>
      </>
    );
  };

  return (
    <div className="content">
      <h1>Consulta médica</h1>
      <p className="sub">La lista se ordena por prioridad clínica y luego por hora de llegada. Al cerrar la atención se emite la receta y el consultorio queda libre.</p>

      {current && (
        <div className="grid med">
          <PatientSummary turn={current} patient={pat(current)} onHC={() => docs.openHC(current.dni)} />
          <Card title={`Atención en curso · ${area}`}>
            <ConsultForm key={current.id} turn={current} patient={pat(current)} onDone={docs.openRecipe} />
          </Card>
        </div>
      )}

      <div className="grid">
        <Card
          title={`Lista de espera (${queue.filter((t) => t.state !== 'EN_CONSULTA').length})`}
          actions={
            <>
              <select aria-label="Consultorio" className="sm-select" value={area} onChange={(e) => setArea(e.target.value)}>
                {AREAS.map((a) => <option key={a}>{a}</option>)}
              </select>
              {!current && queue.some((t) => t.state === 'EN_ESPERA_CONSULTA') && (
                <button className="btn sm" onClick={() => run(callNext, 'med', byPriority)}>Llamar siguiente</button>
              )}
            </>
          }
        >
          <div className="list">
            {queue.length ? queue.map((t) => (
              <div className={`item ${t.state === 'LLAMADO_CONSULTA' && t.dest === area ? 'sel' : ''} ${t.prio === 'CRITICA' ? 'crit-row' : ''}`} key={t.id}>
                <div className="l">
                  <span><Code>{t.id}</Code> · {fullName(pat(t))}</span>
                  <small>{t.tri.motivo} · espera <WaitTime turn={t} now={now} /></small>
                </div>
                <PrioBadge prio={t.prio} />
                <div className="item-a">{actions(t)}</div>
              </div>
            )) : <Empty>No hay pacientes en espera de consulta.</Empty>}
          </div>
        </Card>
        <Card title={`Recetas emitidas hoy (${today.length})`}>
          <div className="list">
            {today.length ? today.map((t) => (
              <div className="item" key={t.id}>
                <div className="l">
                  <span><Code>{t.consult.rec}</Code> · {fullName(pat(t))}</span>
                  <small>{fmtT(t.consult.t)} · {t.consult.dest} · {t.consult.medico?.n}</small>
                </div>
                <button className="btn sec sm" onClick={() => docs.openRecipe(t.id)}>Ver receta</button>
              </div>
            )) : <Empty>Aún no hay recetas.</Empty>}
          </div>
        </Card>
      </div>
      {docs.element}
      {dialog}
    </div>
  );
}
