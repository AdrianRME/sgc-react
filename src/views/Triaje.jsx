import { useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { callTurn, callNext, startTriage, saveTriage, returnToQueue, cancelTurn } from '../store/actions.js';
import { evalTriage, validateVitals, imcCategory, byArrival } from '../lib/clinical.js';
import { age, fullName } from '../lib/format.js';
import { PRIO } from '../lib/constants.js';
import { Badge, Card, Code, Empty, Field, Msg, StateBadge, WaitTime, useConfirm } from '../components/ui.jsx';
import { useNow } from '../hooks/useNow.js';

const EMPTY = { pa: '', fc: '', fr: '', t: '', spo2: '', peso: '', talla: '', motivo: '' };

const VITALS = [
  ['pa', 'PA (mmHg)', { placeholder: '120/80', inputMode: 'numeric' }],
  ['fc', 'FC (lpm)', { type: 'number', inputMode: 'numeric' }],
  ['fr', 'FR (rpm)', { type: 'number', inputMode: 'numeric' }],
  ['t', 'Temp. (°C)', { type: 'number', step: '0.1', inputMode: 'decimal' }],
  ['spo2', 'SpO₂ (%)', { type: 'number', inputMode: 'numeric' }],
  ['peso', 'Peso (kg)', { type: 'number', step: '0.1', inputMode: 'decimal' }],
  ['talla', 'Talla (m)', { type: 'number', step: '0.01', inputMode: 'decimal', placeholder: '1.65' }],
];

const STATUS_TXT = { crit: 'Crítico', warn: 'Alerta', ok: 'Normal' };

function TriageForm({ turn, patient }) {
  const { run, th } = useStore();
  const [v, setV] = useState(EMPTY);
  const [alg, setAlg] = useState(patient.alg || '');
  const [tried, setTried] = useState(false);
  const errs = tried ? validateVitals(v) : {};
  const r = evalTriage(v, th);
  const cat = imcCategory(r.imc);
  const anyVital = ['fc', 'fr', 't', 'spo2', 'pa'].some((k) => v[k]);

  const submit = (e) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(validateVitals(v)).length) return;
    run(saveTriage, turn.id, v, alg);
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="patient-head">
        <div>
          <b><Code>{turn.id}</Code> · {fullName(patient)}</b>
          <small>{age(patient.nac)} años · {patient.sexo === 'F' ? 'Femenino' : 'Masculino'} · DNI {patient.dni}</small>
        </div>
        {anyVital && <Badge tone={r.prio === 'CRITICA' ? 'crit' : r.prio === 'PRIORITARIA' ? 'warn' : 'ok'}>Prioridad: {PRIO[r.prio][0]}</Badge>}
      </div>

      <div className="vgrid">
        {VITALS.map(([k, label, props]) => {
          const st = r.status[k];
          return (
            <Field key={k} label={label} error={errs[k]} className={st ? `v-${st}` : ''}>
              {(a) => (
                <div className="vin">
                  <input {...a} {...props} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
                  {st && <span className={`vdot ${st}`} title={STATUS_TXT[st]} aria-label={STATUS_TXT[st]} />}
                </div>
              )}
            </Field>
          );
        })}
        <div className="field">
          <label>IMC (kg/m²)</label>
          <div className="imc">
            {r.imc ?? '—'} {cat && <Badge tone={cat[1]}>{cat[0]}</Badge>}
          </div>
        </div>
      </div>

      <Field label="Motivo de consulta" error={errs.motivo}>
        {(a) => <input {...a} value={v.motivo} onChange={(e) => setV((x) => ({ ...x, motivo: e.target.value }))} placeholder="Ej. Dolor de garganta y tos de 3 días" />}
      </Field>
      <Field label="Alergias (confirmar con el paciente)" hint="Se actualiza en la historia clínica.">
        {(a) => <input {...a} value={alg} onChange={(e) => setAlg(e.target.value)} placeholder="Ninguna conocida" />}
      </Field>

      {r.c.length > 0 && <Msg tone="crit"><b>ALERTA CRÍTICA · prioridad CRÍTICA</b><br />{r.c.join(' · ')}</Msg>}
      {!r.c.length && r.w.length > 0 && <Msg tone="warn"><b>Prioridad PRIORITARIA</b><br />{r.w.join(' · ')}</Msg>}
      {anyVital && !r.c.length && !r.w.length && <Msg tone="ok">Sin alertas en los valores ingresados · prioridad NORMAL</Msg>}

      <div className="actions">
        <button className="btn">Finalizar triaje</button>
        <button type="button" className="btn ghost" onClick={() => run(returnToQueue, turn.id)}>Devolver a la lista</button>
      </div>
      <p className="note">
        Umbrales vigentes · críticos: SpO₂ &lt; {th.spo2} %, T ≥ {th.tmp} °C, PAS &lt; {th.pasLo}, FC &gt; {th.fcHi}, FR &gt; {th.frHi}.
        Alerta: SpO₂ ≤ {th.spo2A} %, T ≥ {th.tmpA} °C, PAS ≥ {th.pasA}, FC &gt; {th.fcA}, FR ≥ {th.frA}.
      </p>
    </form>
  );
}

export function Triaje() {
  const { db, run } = useStore();
  const now = useNow();
  const [ask, dialog] = useConfirm();
  const queue = db.turns.filter((t) => ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE'].includes(t.state)).sort(byArrival);
  const current = db.turns.find((t) => t.state === 'EN_TRIAJE');
  const pat = (t) => db.patients.find((p) => p.dni === t.dni);

  const noShow = (t) =>
    ask({
      title: `¿${t.id} no se presentó?`,
      text: 'El turno se cerrará y el paciente deberá volver a admisión si regresa.',
      confirmLabel: 'Cerrar turno',
      danger: true,
      onConfirm: () => run(cancelTurn, t.id, 'No se presentó al llamado'),
    });

  return (
    <div className="content">
      <h1>Triaje</h1>
      <p className="sub">Registre los signos vitales. El sistema calcula el IMC y asigna la prioridad según los umbrales clínicos aprobados.</p>
      <div className="grid">
        <Card
          title={`Lista de espera (${queue.length})`}
          actions={queue.some((t) => t.state === 'EN_ESPERA_TRIAJE') && (
            <button className="btn sm" onClick={() => run(callNext, 'tri', byArrival)}>Llamar siguiente</button>
          )}
        >
          <div className="list">
            {queue.length ? queue.map((t) => (
              <div className={`item ${t.state === 'LLAMADO_TRIAJE' ? 'sel' : ''}`} key={t.id}>
                <div className="l">
                  <span><Code>{t.id}</Code> · {fullName(pat(t))}</span>
                  <small>{age(pat(t).nac)} años · espera <WaitTime turn={t} now={now} />{t.calls > 1 && ` · llamado ${t.calls} veces`}</small>
                </div>
                <StateBadge state={t.state} />
                <div className="item-a">
                  {t.state === 'EN_ESPERA_TRIAJE' && <button className="btn sec sm" onClick={() => run(callTurn, t.id)}>Llamar</button>}
                  {t.state === 'LLAMADO_TRIAJE' && (
                    <>
                      <button className="btn sm" onClick={() => run(startTriage, t.id)} disabled={!!current}>Iniciar triaje</button>
                      <button className="btn sec sm" onClick={() => run(callTurn, t.id)}>Repetir</button>
                      <button className="btn dng sm" onClick={() => noShow(t)}>No se presentó</button>
                    </>
                  )}
                </div>
              </div>
            )) : <Empty>No hay pacientes en espera de triaje.</Empty>}
          </div>
        </Card>
        <Card title="Registro de signos vitales">
          {current ? (
            <TriageForm key={current.id} turn={current} patient={pat(current)} />
          ) : (
            <Empty>Llame a un paciente y pulse «Iniciar triaje».</Empty>
          )}
        </Card>
      </div>
      {dialog}
    </div>
  );
}
