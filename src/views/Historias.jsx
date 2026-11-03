import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { LockKeyhole, Search, UserRound } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { normalize } from '../lib/clinical.js';
import { MOTIVOS_ACCESO_HC } from '../lib/constants.js';
import { accesoJustificado, atiendeA } from '../store/actions.js';
import { age, fullName, startOfToday } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { usePatientHistory } from '../hooks/usePatientHistory.js';
import { WorkspaceHeader } from '../components/WorkspaceHeader.jsx';
import { Empty, Field, Msg, Panel, SisBadge } from '../components/ui.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { PatientTimeline, VitalTrends } from '../components/PatientTimeline.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import '../components/charts/charts.css';
import './workspaces.css';

function Record({ patient, docs }) {
  const h = usePatientHistory(patient.dni);
  return (
    <m.div {...listItem} className="stack">
      <div className="patient-card">
        <Icon3D name="folder" size={44} />
        <div className="pc-main">
          <b>{fullName(patient)}</b>
          <small>{patient.hc}, {age(patient.nac)} años, {patient.sexo === 'F' ? 'femenino' : 'masculino'}, DNI {patient.dni}</small>
        </div>
        <SisBadge sis={patient.sis} />
      </div>
      {patient.alg && <Msg tone="crit"><b>Alergia:</b> {patient.alg}</Msg>}
      <p className="note"><b>Antecedentes:</b> {patient.ant || 'Ninguno registrado'}</p>
      <VitalTrends visits={h.visits} />
      <h3 className="h3">Atenciones ({h.attended.length})</h3>
      <PatientTimeline visits={h.attended} loading={h.loading} onRecipe={docs.openRecipe} />
      {h.error && <Msg tone="crit">{h.error}</Msg>}
      <p className="note">Esta consulta queda registrada en la auditoría (RF-18).</p>
    </m.div>
  );
}

/**
 * Acceso a la historia de un paciente que el profesional no está atendiendo: se pide el motivo antes de
 * mostrarla (acceso de emergencia) y queda en la auditoría.
 */
function Justificar({ patient, onOk, onCancel }) {
  const { run } = useStore();
  const [motivo, setMotivo] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(accesoJustificado, patient.dni, motivo);
    if (r.ok) onOk();
  };
  return (
    <m.form {...listItem} className="stack" onSubmit={submit}>
      <Msg tone="warn">
        <b><LockKeyhole aria-hidden="true" /> Acceso restringido.</b> {fullName(patient)} ({patient.hc}) no está entre sus pacientes de hoy.
        Indique por qué necesita su historia: el motivo queda en la auditoría que revisa Jefatura (RF-18).
      </Msg>
      <fieldset className="dest">
        <legend>Motivo del acceso</legend>
        <div className="stack">
          {MOTIVOS_ACCESO_HC.map((x) => (
            <label key={x} className="chk">
              <input type="radio" name="motivo-hc" value={x} checked={motivo === x} onChange={() => setMotivo(x)} /> {x}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="actions">
        <button className="btn" disabled={!motivo}>Abrir la historia</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </m.form>
  );
}

/** Historias clínicas: buscar a un paciente y revisar su evolución (cada apertura queda auditada). */
export default function Historias() {
  const { db, user, patient: byDni } = useStore();
  // Historias ya justificadas en esta sesión (no se vuelve a pedir el motivo del mismo paciente)
  const [permitidas, setPermitidas] = useState(() => new Set());
  const docs = useDocuments();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const nq = normalize(q.trim());
  const found = nq.length >= 3
    ? db.patients.filter((p) => normalize(`${p.dni} ${fullName(p)} ${p.hc}`).includes(nq)).slice(0, 8)
    : [];
  const mineToday = [...new Set(db.turns
    .filter((t) => t.consult?.medico?.u === user.u && t.consult.t >= startOfToday())
    .map((t) => t.dni))].map(byDni).filter(Boolean);
  const open = (p) => setSel(p.dni); // la lectura de la historia la audita el repositorio
  const patient = byDni(sel);
  const libre = patient && (atiendeA(db, user.u, patient.dni) || permitidas.has(patient.dni));
  const list = found.length ? found : nq.length >= 3 ? [] : mineToday;

  return (
    <>
      <WorkspaceHeader
        title="Historias clínicas"
        icon="folder"
        lead="Busque a un paciente por DNI, nombre o número de historia para ver sus atenciones, diagnósticos, recetas y la evolución de sus signos vitales."
      />
      <div className="grid-2 audit-grid">
        <Panel title="Buscar paciente" icon="search">
          <Field label="DNI, nombre o historia">
            {(a) => (
              <div className="search-in">
                <Search aria-hidden="true" />
                <input {...a} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. 70000001, Paredes o HC-000101" autoFocus />
              </div>
            )}
          </Field>
          {!found.length && nq.length < 3 && <p className="note">{mineToday.length ? 'Atendidos por usted hoy:' : 'Escriba al menos 3 caracteres.'}</p>}
          {list.length > 0 ? (
            <ul className="matches">
              {list.map((p) => (
                <li key={p.dni}>
                  <button type="button" aria-current={sel === p.dni} onClick={() => open(p)}>
                    <UserRound aria-hidden="true" />
                    <span><b>{fullName(p)}</b><small>{p.hc}, DNI {p.dni}, {age(p.nac)} años</small></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : nq.length >= 3 && <Empty icon="search" title="Sin coincidencias" />}
        </Panel>
        <Panel title="Historia clínica" icon="clipboard">
          <AnimatePresence mode="wait">
            {patient && !libre ? (
              <Justificar
                key={`j-${patient.dni}`}
                patient={patient}
                onOk={() => setPermitidas((x) => new Set(x).add(patient.dni))}
                onCancel={() => setSel(null)}
              />
            ) : patient ? <Record key={patient.dni} patient={patient} docs={docs} /> : (
              <m.div key="none" {...listItem}><Empty icon="folder" title="Elija un paciente">La historia se abre aquí y su consulta queda auditada.</Empty></m.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>
      {docs.element}
    </>
  );
}
