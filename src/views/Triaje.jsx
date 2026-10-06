import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Check, Megaphone, PhoneCall, Play, Repeat, Undo2, UserX } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { callTurn, callNext, startTriage, saveTriage, returnToQueue, cancelTurn } from '../store/actions.js';
import { evalTriage, validateVitals, imcCategory, byArrival, turnKey } from '../lib/clinical.js';
import { age, fmtD, fullName } from '../lib/format.js';
import { listItem, spring } from '../lib/motion.js';
import { CANCEL, QUEUE } from '../lib/constants.js';
import { useNow } from '../hooks/useNow.js';
import { usePatientHistory } from '../hooks/usePatientHistory.js';
import { WorkspaceHeader } from '../components/WorkspaceHeader.jsx';
import { Badge, Empty, Field, Msg, Panel, PrioBadge, StateBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { noShowDialog, useConfirm } from '../hooks/useConfirm.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { VitalTrends } from '../components/PatientTimeline.jsx';
import '../components/charts/charts.css';
import './workspaces.css';

const EMPTY = { pa: '', fc: '', fr: '', t: '', spo2: '', peso: '', talla: '', motivo: '' };

/** Signos con su ícono y la regla que los marca, escrita con los umbrales vigentes. */
const VITALS = [
  ['pa', 'PA (mmHg)', 'heart', { placeholder: '120/80', inputMode: 'numeric' }, (T) => `Crítico si PAS < ${T.pasLo}; alerta si ≥ ${T.pasA}`],
  ['fc', 'FC (lpm)', 'stopwatch', { type: 'number', inputMode: 'numeric' }, (T) => `Alerta si > ${T.fcA}; crítico si > ${T.fcHi} o < 40`],
  ['fr', 'FR (rpm)', 'lungs', { type: 'number', inputMode: 'numeric' }, (T) => `Alerta si ≥ ${T.frA}; crítico si > ${T.frHi} o < 8`],
  ['t', 'Temp. (°C)', 'thermometer', { type: 'number', step: '0.1', inputMode: 'decimal' }, (T) => `Alerta si ≥ ${T.tmpA}; crítico si ≥ ${T.tmp}`],
  ['spo2', 'SpO₂ (%)', 'blood', { type: 'number', inputMode: 'numeric' }, (T) => `Alerta si ≤ ${T.spo2A}; crítico si < ${T.spo2}`],
];
const BODY = [
  ['peso', 'Peso (kg)', { type: 'number', step: '0.1', inputMode: 'decimal' }],
  ['talla', 'Talla (m)', { type: 'number', step: '0.01', inputMode: 'decimal', placeholder: '1.65' }],
];
const STATUS_TXT = { crit: 'Crítico', warn: 'Alerta', ok: 'Normal' };

function TriageForm({ turn, patient }) {
  const { run, th } = useStore();
  const hist = usePatientHistory(patient.dni);
  const [v, setV] = useState(EMPTY);
  const [alg, setAlg] = useState(patient.alg || '');
  const [tried, setTried] = useState(false);
  const errs = tried ? validateVitals(v) : {};
  const r = evalTriage(v, th);
  const cat = imcCategory(r.imc);
  const anyVital = ['fc', 'fr', 't', 'spo2', 'pa'].some((k) => v[k]);
  const prev = hist.visits.filter((x) => x.tri && turnKey(x) !== turnKey(turn));
  const last = prev[0];
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(validateVitals(v)).length) return;
    run(saveTriage, turn.id, v, alg);
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <div className="patient-card">
        <TurnCode id={turn.id} className="big" />
        <div className="pc-main">
          <b>{fullName(patient)}</b>
          <small>{age(patient.nac)} años, {patient.sexo === 'F' ? 'femenino' : 'masculino'}, DNI {patient.dni}</small>
        </div>
        <AnimatePresence mode="popLayout">
          {anyVital && (
            <m.span key={r.prio} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1, transition: spring }} exit={{ scale: 0.6, opacity: 0 }}>
              <PrioBadge prio={r.prio} />
            </m.span>
          )}
        </AnimatePresence>
      </div>
      {patient.alg && <Msg tone="crit"><b>Alergia registrada:</b> {patient.alg}</Msg>}
      {last && (
        <p className="note last-visit">
          Última toma ({fmtD(last.t0)}): PA {last.tri.pa}, FC {last.tri.fc}, T {last.tri.t} °C, SpO₂ {last.tri.spo2} %, peso {last.tri.peso} kg.
        </p>
      )}

      <div className="vtiles">
        {VITALS.map(([k, label, icon, props, rule]) => {
          const st = r.status[k];
          return (
            <div key={k} className={`vtile ${st ? `v-${st}` : ''}`}>
              <Icon3D name={icon} size={30} />
              <Field label={label} error={errs[k]} hint={!errs[k] ? rule(th) : undefined}>
                {(a) => <input {...a} {...props} value={v[k]} onChange={set(k)} />}
              </Field>
              <AnimatePresence>
                {st && (
                  <m.span className={`vstate ${st}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    {STATUS_TXT[st]}
                  </m.span>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        <div className="vtile body">
          {BODY.map(([k, label, props]) => (
            <Field key={k} label={label} error={errs[k]}>{(a) => <input {...a} {...props} value={v[k]} onChange={set(k)} />}</Field>
          ))}
          <div className="imc" aria-live="polite">
            <span>IMC</span>
            <b>{r.imc ?? '—'}</b>
            {cat && <Badge tone={cat[1]}>{cat[0]}</Badge>}
          </div>
        </div>
      </div>

      <Field label="Motivo de consulta" error={errs.motivo}>
        {(a) => <input {...a} value={v.motivo} onChange={set('motivo')} placeholder="Ej. Dolor de garganta y tos de 3 días" />}
      </Field>
      <Field label="Alergias (confirmar con el paciente)" hint="Se actualiza en la historia clínica.">
        {(a) => <input {...a} value={alg} onChange={(e) => setAlg(e.target.value)} placeholder="Ninguna conocida" />}
      </Field>

      {r.c.length > 0 && <Msg tone="crit"><b>Alerta crítica: prioridad CRÍTICA.</b> {r.c.join(', ')}.</Msg>}
      {!r.c.length && r.w.length > 0 && <Msg tone="warn"><b>Prioridad PRIORITARIA.</b> {r.w.join(', ')}.</Msg>}
      {anyVital && !r.c.length && !r.w.length && <Msg tone="ok">Sin alertas en los valores ingresados: prioridad NORMAL.</Msg>}

      <div className="actions">
        <button className="btn lg"><Check /> Finalizar triaje</button>
        <button type="button" className="btn ghost" onClick={() => run(returnToQueue, turn.id)}><Undo2 /> Devolver a la lista</button>
      </div>

      {prev.length >= 2 && (
        <details className="trends-box">
          <summary>Tendencia de signos en {prev.length} visitas anteriores</summary>
          <VitalTrends visits={prev} />
        </details>
      )}
    </form>
  );
}

export default function Triaje() {
  const { db, run, patient } = useStore();
  const now = useNow();
  const [ask, dialog] = useConfirm();
  const queue = db.turns.filter((t) => QUEUE.enf.includes(t.state)).sort(byArrival);
  const current = db.turns.find((t) => t.state === 'EN_TRIAJE');
  const pat = (t) => patient(t.dni);

  const noShow = (t) =>
    ask(noShowDialog(t, 'El turno se cerrará y el paciente deberá volver a admisión si regresa.', () => run(cancelTurn, t.id, CANCEL.noShow)));

  return (
    <>
      <WorkspaceHeader title="Lista de triaje" route figs />
      <div className="grid-2 wide-r">
        <Panel
          title="Lista de espera"
          count={queue.length}
          icon="clipboard"
          actions={queue.some((t) => t.state === 'EN_ESPERA_TRIAJE') && (
            <button className="btn sm" onClick={() => run(callNext, 'tri', byArrival)}><Megaphone /> Llamar siguiente</button>
          )}
        >
          {queue.length ? (
            <ul className="queue">
              <AnimatePresence initial={false}>
                {queue.map((t) => (
                  <m.li key={t.id} {...listItem} layout className={`qrow ${t.state === 'LLAMADO_TRIAJE' ? 'sel' : ''}`}>
                    <TurnCode id={t.id} />
                    <div className="qmain">
                      <span className="who">{fullName(pat(t))}</span>
                      <span className="meta">
                        <span>{age(pat(t).nac)} años</span>
                        <WaitTime turn={t} now={now} />
                        {t.calls > 1 && <span>llamado {t.calls} veces</span>}
                      </span>
                    </div>
                    <div className="qside"><StateBadge state={t.state} /></div>
                    <div className="acts">
                      {t.state === 'EN_ESPERA_TRIAJE' && <button className="btn sec sm" onClick={() => run(callTurn, t.id)}><PhoneCall /> Llamar</button>}
                      {t.state === 'LLAMADO_TRIAJE' && (
                        <>
                          <button className="btn sm" onClick={() => run(startTriage, t.id)} disabled={!!current}><Play /> Iniciar triaje</button>
                          <button className="btn sec sm" onClick={() => run(callTurn, t.id)}><Repeat /> Repetir</button>
                          <button className="btn dng sm" onClick={() => noShow(t)}><UserX /> No se presentó</button>
                        </>
                      )}
                    </div>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="check" title="No hay pacientes en espera de triaje" />}
        </Panel>
        <Panel title="Registro de signos vitales" icon="thermometer">
          <AnimatePresence mode="wait">
            {current ? (
              <m.div key={current.id} {...listItem}>
                <TriageForm turn={current} patient={pat(current)} />
              </m.div>
            ) : (
              <m.div key="none" {...listItem}>
                <Empty icon="thermometer" title="Ningún paciente en triaje">Llame a un paciente y pulse «Iniciar triaje».</Empty>
              </m.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>
      {dialog}
    </>
  );
}
