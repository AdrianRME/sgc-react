import { useState } from 'react';
import { Modal, SisBadge } from './ui.jsx';
import { useStore } from '../store/StoreProvider.jsx';
import { fmtD, fmtDT, age, maskDni, fullName } from '../lib/format.js';
import { hcAudit } from '../store/actions.js';

const DocHead = ({ title, code }) => (
  <>
    <div className="doc-h">
      <h3>{title}</h3>
      <b className="code">{code}</b>
    </div>
    <div className="doc-sub">Centro de Salud (demo)</div>
    <hr />
  </>
);

const DocActions = ({ onClose, print = true }) => (
  <div className="actions end no-print">
    {print && <button className="btn sec" onClick={() => window.print()}>Imprimir</button>}
    <button className="btn" onClick={onClose}>Cerrar</button>
  </div>
);

export function Recipe({ id, onClose }) {
  const { db } = useStore();
  const t = db.turns.find((x) => x.id === id);
  const p = db.patients.find((x) => x.dni === t?.dni);
  if (!t?.consult) return null;
  const c = t.consult;
  return (
    <Modal label="Receta" onClose={onClose}>
      <DocHead title="Prescripción farmacológica" code={c.rec} />
      <div className="meta">
        <span><b>Paciente:</b> {fullName(p)}</span>
        <span><b>DNI:</b> {p.dni}</span>
        <span><b>HC:</b> {p.hc}</span>
        <span><b>Edad:</b> {age(p.nac)} años</span>
        <span><b>Fecha:</b> {fmtDT(c.t)}</span>
      </div>
      {p.alg && <div className="meta"><span><b>Alergias:</b> {p.alg}</span></div>}
      <div className="meta">
        <span>
          <b>Diagnóstico:</b>{' '}
          {c.dx.map((d) => `${d[0]} – ${d[1]} (${d[2] === 'D' ? 'definitivo' : 'presuntivo'})`).join('; ')}
        </span>
      </div>
      <hr />
      <div className="tblw">
        <table>
          <thead>
            <tr><th>Medicamento</th><th>Dosis y frecuencia</th><th>Duración</th><th>Cant.</th></tr>
          </thead>
          <tbody>
            {c.meds.length ? c.meds.map((m, i) => (
              <tr key={i}><td>{m.n}</td><td>{[m.dosis, m.frec].filter(Boolean).join(' · ')}</td><td>{m.dias ? `${m.dias} días` : ''}</td><td>{m.cant}</td></tr>
            )) : <tr><td colSpan="4">Sin medicamentos indicados</td></tr>}
          </tbody>
        </table>
      </div>
      <hr />
      <div className="meta">
        <span><b>Destino:</b> {c.dest}{c.destx ? ` · ${c.dest === 'Reposo médico' ? `${c.destx} días` : c.destx}` : ''}</span>
      </div>
      <div className="sign">
        {c.area} · Firma: {c.medico?.n} · {c.medico?.col} (ficticio)
      </div>
      <div className="wm">Documento de demostración sin validez clínica ni legal.</div>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

export function Ticket({ id, onClose }) {
  const { db } = useStore();
  const t = db.turns.find((x) => x.id === id);
  const p = db.patients.find((x) => x.dni === t?.dni);
  if (!t) return null;
  return (
    <Modal label="Ticket de turno" onClose={onClose} className="tk">
      <div className="doc-sub">Centro de Salud (demo)</div>
      <div style={{ margin: '10px 0 2px' }}>Su turno</div>
      <div className="code tk-n">{t.id}</div>
      <hr />
      <div className="tk-b">
        Diríjase a <b>Triaje</b>
        <br />Emitido: {fmtDT(t.t0)}
        <br />DNI {maskDni(p.dni)}
      </div>
      <div className="doc-sub" style={{ marginTop: 10 }}>Permanezca atento a la pantalla de sala.</div>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

export function ClinicalHistory({ dni, onClose }) {
  const { db } = useStore();
  const p = db.patients.find((x) => x.dni === dni);
  const h = db.turns.filter((t) => t.dni === dni && t.consult).sort((a, b) => b.consult.t - a.consult.t);
  if (!p) return null;
  return (
    <Modal label="Historia clínica" onClose={onClose}>
      <DocHead title="Historia clínica digital" code={p.hc} />
      <div className="meta">
        <span><b>{fullName(p)}</b></span>
        <span>DNI {p.dni}</span>
        <span>{age(p.nac)} años · {p.sexo === 'F' ? 'Femenino' : 'Masculino'}</span>
        <SisBadge sis={p.sis} />
      </div>
      <hr />
      <div className="meta">
        <span><b>Antecedentes:</b> {p.ant || 'Ninguno registrado'}</span>
        <span><b>Alergias:</b> {p.alg || 'Ninguna conocida'}</span>
      </div>
      <hr />
      <h4>Atenciones previas ({h.length})</h4>
      {h.length ? (
        <div className="tblw">
          <table>
            <thead><tr><th>Fecha</th><th>Diagnóstico</th><th>Tratamiento</th><th>Destino</th><th>Médico</th></tr></thead>
            <tbody>
              {h.map((t) => (
                <tr key={t.id}>
                  <td>{fmtD(t.consult.t)}</td>
                  <td>{t.consult.dx.map((d) => d[0]).join(', ')}</td>
                  <td>{t.consult.meds.map((m) => m.n).join(', ') || '—'}</td>
                  <td>{t.consult.dest}</td>
                  <td>{t.consult.medico?.n || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="doc-sub">Sin atenciones previas.</div>
      )}
      <div className="wm info">Este acceso queda registrado en la auditoría (RF-18).</div>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

/** Abre ticket, receta o historia clínica desde cualquier vista. Abrir la HC queda auditado. */
export function useDocuments() {
  const { run } = useStore();
  const [doc, setDoc] = useState(null);
  const close = () => setDoc(null);
  const openHC = (dni) => {
    run(hcAudit, dni);
    setDoc({ k: 'hc', dni });
  };
  const element =
    doc?.k === 'tk' ? <Ticket id={doc.id} onClose={close} />
    : doc?.k === 'rec' ? <Recipe id={doc.id} onClose={close} />
    : doc?.k === 'hc' ? <ClinicalHistory dni={doc.dni} onClose={close} />
    : null;
  return {
    openTicket: (id) => setDoc({ k: 'tk', id }),
    openRecipe: (id) => setDoc({ k: 'rec', id }),
    openHC,
    element,
  };
}
