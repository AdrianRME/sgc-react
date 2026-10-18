import { Printer } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { fmtDT, fmtHora, fmtLongDay, fmtSoles, age, maskDni, fullName } from '../lib/format.js';
import { CONCEPTO_PAGO, METODOS_PAGO, TARIFA_CONSULTA } from '../lib/constants.js';
import { especialidad, sameDay } from '../lib/agenda.js';
import { usePatientHistory } from '../hooks/usePatientHistory.js';
import { useNow } from '../hooks/useNow.js';
import { Modal } from './Modal.jsx';
import { Msg, SisBadge } from './ui.jsx';
import { Icon3D } from './Icon3D.jsx';
import { BrandMark } from './BrandMark.jsx';
import { PatientTimeline, VitalTrends } from './PatientTimeline.jsx';
import './documents.css';

const DocHead = ({ title, code, icon }) => (
  <header className="doc-h">
    <BrandMark />
    <div>
      <small>Centro de Salud (demo)</small>
      <h3>{title}</h3>
    </div>
    {code && <b className="tcode doc-code">{code}</b>}
    {icon && <Icon3D name={icon} size={44} />}
  </header>
);

const DocActions = ({ onClose }) => (
  <div className="actions end no-print">
    <button className="btn sec" onClick={() => window.print()}><Printer /> Imprimir</button>
    <button className="btn" onClick={onClose}>Cerrar</button>
  </div>
);

export function Recipe({ turn: t, onClose }) {
  const { patient } = useStore();
  const p = patient(t.dni);
  const c = t.consult;
  return (
    <Modal label="Receta" onClose={onClose} className="doc">
      <DocHead title="Prescripción farmacológica" code={c.rec} />
      <dl className="doc-meta">
        <div><dt>Paciente</dt><dd>{fullName(p)}</dd></div>
        <div><dt>DNI</dt><dd>{p?.dni}</dd></div>
        <div><dt>Historia</dt><dd>{p?.hc}</dd></div>
        <div><dt>Edad</dt><dd>{p ? `${age(p.nac)} años` : '—'}</dd></div>
        <div><dt>Fecha</dt><dd>{fmtDT(c.t)}</dd></div>
      </dl>
      {p?.alg && <Msg tone="crit"><b>Alergias:</b> {p.alg}</Msg>}
      <div className="doc-sec">
        <h4>Diagnóstico</h4>
        <ul className="plain">{c.dx.map((d) => <li key={d[0]}><b className="code">{d[0]}</b> {d[1]} ({d[2] === 'D' ? 'definitivo' : 'presuntivo'})</li>)}</ul>
      </div>
      <div className="tblw">
        <table className="tbl">
          <thead><tr><th>Medicamento</th><th>Dosis y frecuencia</th><th>Duración</th><th className="num">Cant.</th></tr></thead>
          <tbody>
            {c.meds.length ? c.meds.map((x, i) => (
              <tr key={i}><td>{x.n}</td><td>{[x.dosis, x.frec].filter(Boolean).join(', ')}</td><td>{x.dias ? `${x.dias} días` : ''}</td><td className="num">{x.cant}</td></tr>
            )) : <tr><td colSpan="4">Sin medicamentos indicados</td></tr>}
          </tbody>
        </table>
      </div>
      <dl className="doc-meta">
        <div><dt>Destino</dt><dd>{c.dest}{c.destx ? ` (${c.dest === 'Reposo médico' ? `${c.destx} días` : c.destx})` : ''}</dd></div>
        <div><dt>Firma</dt><dd>{c.medico?.n}, {c.medico?.col} (ficticio), {c.area}</dd></div>
      </dl>
      <p className="wm">Documento de demostración sin validez clínica ni legal.</p>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

/** Indicación del ticket según dónde está el paciente en la ruta. */
function nextStep(t) {
  if (t.state === 'PENDIENTE_PAGO') return <>Pase primero a <b>Caja</b> y pague {fmtSoles(TARIFA_CONSULTA)}. Después espere su llamado a <b>Triaje</b>.</>;
  if (['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'].includes(t.state)) {
    return <>{t.pago?.metodo === 'SIS' && 'Exonerado de pago por SIS. '}Diríjase a <b>Triaje</b> y permanezca atento a la pantalla de sala.</>;
  }
  if (t.state === 'PENDIENTE_CITA') return <>Acérquese a <b>Admisión</b> para sacar su cita con el especialista.</>;
  return <>Permanezca atento a la pantalla de sala.</>;
}

export function Ticket({ turn: t, onClose }) {
  const { patient } = useStore();
  const p = patient(t.dni);
  return (
    <Modal label="Ticket de turno" onClose={onClose} size="sm" className="doc ticket">
      <DocHead title="Su turno" icon="ticket" />
      <div className="tk-n tcode">{t.id}</div>
      <p className="tk-b">{nextStep(t)}</p>
      <dl className="doc-meta">
        <div><dt>Emitido</dt><dd>{fmtDT(t.t0)}</dd></div>
        <div><dt>DNI</dt><dd>{p ? maskDni(p.dni) : '—'}</dd></div>
      </dl>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

/** Boleta de la consulta (demostración, sin validez tributaria). */
export function Comprobante({ turn: t, onClose }) {
  const { patient, db } = useStore();
  const p = patient(t.dni);
  const g = t.pago;
  const cajero = db.users.find((x) => x.u === g.by)?.n ?? g.by;
  return (
    <Modal label="Comprobante de pago" onClose={onClose} size="sm" className="doc">
      <DocHead title="Boleta de venta" code={g.comp ?? 'SIS'} />
      <dl className="doc-meta">
        <div><dt>Paciente</dt><dd>{fullName(p)}</dd></div>
        <div><dt>DNI</dt><dd>{p?.dni}</dd></div>
        <div><dt>Fecha</dt><dd>{fmtDT(g.t)}</dd></div>
        <div><dt>Turno</dt><dd>{t.id}</dd></div>
      </dl>
      <div className="tblw">
        <table className="tbl">
          <thead><tr><th>Concepto</th><th className="num">Importe</th></tr></thead>
          <tbody>
            <tr><td>{CONCEPTO_PAGO}</td><td className="num">{fmtSoles(g.monto)}</td></tr>
            <tr><td><b>Total</b></td><td className="num"><b>{fmtSoles(g.monto)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <dl className="doc-meta">
        <div><dt>Medio de pago</dt><dd>{METODOS_PAGO[g.metodo]}</dd></div>
        <div><dt>Atendido por</dt><dd>{cajero}</dd></div>
      </dl>
      <p className="wm">Documento de demostración sin validez tributaria.</p>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

/** Constancia de cita: qué especialista, dónde y cuándo. */
export function ConstanciaCita({ turn: t, onClose }) {
  const { patient, db } = useStore();
  const p = patient(t.dni);
  const c = t.cita;
  const doc = db.users.find((x) => x.u === c.med);
  const now = useNow(60_000);
  const hoy = sameDay(c.at, now);
  return (
    <Modal label="Constancia de cita" onClose={onClose} size="sm" className="doc ticket">
      <DocHead title="Constancia de cita" icon="calendar" />
      <div className="tk-n tcode">{fmtHora(c.at)}</div>
      <p className="tk-b"><b>{hoy ? 'Hoy' : fmtLongDay(c.at)}</b>, {especialidad(c.esp)?.n}, {doc?.n ?? c.med}, {c.area}.</p>
      <p className="tk-b">{hoy
        ? 'Espere en la sala: su código aparecerá en la pantalla cuando el médico lo llame.'
        : 'Ese día preséntese en Admisión con su DNI 15 minutos antes de su hora. No necesita volver a pagar ni pasar por triaje.'}</p>
      {c.sobre && <Msg tone="crit">Sobrecupo por prioridad crítica: será atendido lo antes posible.</Msg>}
      <dl className="doc-meta">
        <div><dt>Turno</dt><dd>{t.id}</dd></div>
        <div><dt>Paciente</dt><dd>{p ? `${p.nom} ${p.ape.split(' ')[0]}` : '—'}</dd></div>
        <div><dt>DNI</dt><dd>{p ? maskDni(p.dni) : '—'}</dd></div>
      </dl>
      <DocActions onClose={onClose} />
    </Modal>
  );
}

export function ClinicalHistory({ dni, onClose, onRecipe }) {
  const { patient } = useStore();
  const p = patient(dni);
  const h = usePatientHistory(dni);
  if (!p) return null;
  return (
    <Modal label="Historia clínica" onClose={onClose} className="doc wide">
      <DocHead title="Historia clínica digital" code={p.hc} />
      <dl className="doc-meta">
        <div><dt>Paciente</dt><dd>{fullName(p)}</dd></div>
        <div><dt>DNI</dt><dd>{p.dni}</dd></div>
        <div><dt>Edad y sexo</dt><dd>{age(p.nac)} años, {p.sexo === 'F' ? 'femenino' : 'masculino'}</dd></div>
        <div><dt>Seguro</dt><dd><SisBadge sis={p.sis} /></dd></div>
        <div><dt>Antecedentes</dt><dd>{p.ant || 'Ninguno registrado'}</dd></div>
        <div><dt>Alergias</dt><dd className={p.alg ? 'alg' : ''}>{p.alg || 'Ninguna conocida'}</dd></div>
      </dl>
      <VitalTrends visits={h.visits} />
      <div className="doc-sec">
        <h4>Atenciones ({h.attended.length})</h4>
        <PatientTimeline visits={h.attended} loading={h.loading} onRecipe={onRecipe} />
      </div>
      {h.error && <Msg tone="crit">{h.error}</Msg>}
      <p className="wm info">Este acceso queda registrado en la auditoría (RF-18).</p>
      <DocActions onClose={onClose} />
    </Modal>
  );
}
