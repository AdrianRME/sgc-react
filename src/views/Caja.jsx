import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Ban, Banknote, CreditCard, Receipt, Smartphone } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { registerPayment, cancelTurn } from '../store/actions.js';
import { byArrival } from '../lib/clinical.js';
import { CANCEL, CONCEPTO_PAGO, METODOS_PAGO, QUEUE, TARIFA_CONSULTA } from '../lib/constants.js';
import { age, cap, fmtLongDay, fmtSoles, fmtT, fullName, iniciales, saludo, startOfToday } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { SectionHero } from '../components/SectionHero.jsx';
import { Help } from '../components/WorkspaceHeader.jsx';
import { Badge, Empty, Field, Msg, Panel, SisBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import './workspaces.css';

const METODOS = [['EFECTIVO', Banknote], ['TARJETA', CreditCard], ['BILLETERA', Smartphone]];
const BILLETES = [20, 50, 100];

/** Cobro de un turno: medio de pago, vuelto en efectivo y boleta. */
function Cobro({ turn, patient, onPaid, onCancel }) {
  const { run } = useStore();
  const [metodo, setMetodo] = useState('EFECTIVO');
  const [recibido, setRecibido] = useState('');
  const cash = metodo === 'EFECTIVO';
  const vuelto = cash && recibido !== '' ? +recibido - TARIFA_CONSULTA : null;

  const submit = async (e) => {
    e.preventDefault();
    const r = await run(registerPayment, turn.id, { metodo, recibido });
    if (r.ok) onPaid(r.result);
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      <div className="patient-card">
        <TurnCode id={turn.id} className="big" />
        <div className="pc-main">
          <b>{fullName(patient)}</b>
          {patient ? <small>{age(patient.nac)} años, DNI {patient.dni}, {patient.hc}</small> : <small>Datos del paciente no disponibles</small>}
        </div>
        {patient && <SisBadge sis={patient.sis} />}
      </div>
      <div className="charge">
        <span>{CONCEPTO_PAGO}</span>
        <b>{fmtSoles(TARIFA_CONSULTA)}</b>
      </div>
      <fieldset className="dest">
        <legend>Medio de pago</legend>
        <div className="dest-opts">
          {METODOS.map(([k, Icon]) => (
            <label key={k} className={`dest-opt ${metodo === k ? 'on' : ''}`}>
              <input type="radio" name={`metodo-${turn.id}`} value={k} checked={metodo === k} onChange={() => setMetodo(k)} />
              <Icon aria-hidden="true" />
              <span>{METODOS_PAGO[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {cash && (
        <div className="row cash-row">
          <Field label="Monto recibido (S/)" error={vuelto != null && vuelto < 0 ? 'No cubre la tarifa' : undefined}>
            {(a) => <input {...a} type="number" min={TARIFA_CONSULTA} step="0.1" inputMode="decimal" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder={TARIFA_CONSULTA.toFixed(2)} />}
          </Field>
          <div className="quick-cash" role="group" aria-label="Billetes frecuentes">
            {BILLETES.map((b) => <button key={b} type="button" className="btn sec sm" onClick={() => setRecibido(String(b))}>{fmtSoles(b)}</button>)}
          </div>
          <div className="imc" aria-live="polite"><span>Vuelto</span><b>{vuelto != null && vuelto >= 0 ? fmtSoles(vuelto) : '—'}</b></div>
        </div>
      )}
      <div className="actions">
        <button className="btn lg" disabled={cash && !(vuelto >= 0)}><Receipt /> Registrar pago y emitir boleta</button>
        <button type="button" className="btn dng" onClick={onCancel}><Ban /> No pagó</button>
      </div>
      <p className="note">Al pagar, el paciente pasa a la lista de triaje. Los pacientes con SIS no pasan por Caja.</p>
    </form>
  );
}

export default function Caja() {
  const { db, run, patient, user } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [selId, setSelId] = useState(null);
  const queue = db.turns.filter((t) => QUEUE.caj.includes(t.state)).sort(byArrival);
  const sel = queue.find((t) => t.id === selId) || queue[0];
  const today = startOfToday();
  const pagos = db.turns.filter((t) => t.pago && t.pago.t >= today).sort((a, b) => b.pago.t - a.pago.t);
  const [ver, setVer] = useState('cobros');
  const cobros = pagos.filter((t) => t.pago.metodo !== 'SIS');
  const sis = pagos.filter((t) => t.pago.metodo === 'SIS');
  const total = (list) => list.reduce((s, t) => s + t.pago.monto, 0);
  const tiles = [
    { k: 'cola', n: 'Por cobrar', icon: 'hourglass', c: 'caj', value: queue.length, pick: false },
    { k: 'cobros', n: 'Cobrados hoy', icon: 'check', c: 'good', value: cobros.length },
    { k: 'sis', n: 'Exonerados SIS', icon: 'shield', c: 'med', value: sis.length },
    { k: 'total', n: 'Recaudado hoy', icon: 'chartup', c: 'jef', value: total(cobros), format: fmtSoles, pick: false },
  ];

  const noPago = (t) =>
    ask({
      title: `Anular el turno ${t.id}`,
      text: `${fullName(patient(t.dni))} no realizó el pago. El turno se cerrará y no pasará a triaje.`,
      confirmLabel: 'Anular turno',
      danger: true,
      onConfirm: () => run(cancelTurn, t.id, CANCEL.sinPago),
    });

  return (
    <>
      <SectionHero
        icon="scroll"
        kicker={`${cap(fmtLongDay(now))} · ${fmtT(now)}`}
        title={`${saludo(now)}, ${user.n.split(' ')[0]}`}
        text="Caja: cobre la consulta a los pacientes sin seguro y entrégueles su boleta para que pasen a triaje."
        tiles={tiles}
        active={ver}
        onPick={setVer}
        label="Resumen de Caja"
        actions={<Help role="caj" />}
      />
      <div className="grid-2 caj-grid">
        <Panel title="Por cobrar" count={queue.length} icon="hourglass" sub="Sin seguro: pagan antes del triaje, en orden de llegada" className="caj-panel" data-role="caj">
          {queue.length ? (
            <ul className="pacs">
              <AnimatePresence initial={false}>
                {queue.map((t, i) => {
                  const p = patient(t.dni);
                  return (
                    <m.li key={t.id} {...listItem} layout style={{ '--c': 'var(--st-caj)' }}>
                      <button type="button" className="pac pick caj-pac" aria-pressed={sel?.id === t.id} onClick={() => setSelId(t.id)}>
                        <span className="pac-av" aria-hidden="true">{p ? iniciales(p) : '?'}</span>
                        <span className="pac-main">
                          <b>{fullName(p)}</b>
                          <span className="pac-meta">
                            <TurnCode id={t.id} />
                            <span>llegó {fmtT(t.t0)}</span>
                            <WaitTime turn={t} now={now} />
                            {i === 0 && <span className="pac-st">Siguiente</span>}
                          </span>
                        </span>
                      </button>
                    </m.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          ) : <Empty icon="check" title="No hay pagos pendientes" />}
        </Panel>
        <Panel title="Cobro de la consulta" icon="scroll" className="caj-panel" data-role="caj">
          <AnimatePresence mode="wait">
            {sel ? (
              <m.div key={sel.id} {...listItem}>
                <Cobro turn={sel} patient={patient(sel.dni)} onPaid={(t) => { setSelId(null); docs.openPago(t); }} onCancel={() => noPago(sel)} />
              </m.div>
            ) : (
              <m.div key="none" {...listItem}>
                <Empty icon="scroll" title="Nadie esperando en Caja">Los turnos de pacientes no asegurados aparecen aquí al registrarse en Admisión.</Empty>
              </m.div>
            )}
          </AnimatePresence>
        </Panel>
      </div>

      <Panel
        title={ver === 'cobros' ? 'Cobros de hoy' : 'Exonerados SIS de hoy'}
        count={(ver === 'cobros' ? cobros : sis).length}
        icon="barchart"
        sub="Elija «Cobrados hoy» o «Exonerados SIS» en el encabezado para cambiar la lista"
        className="caj-panel"
        data-role={ver === 'cobros' ? 'good' : 'med'}
      >
        <div className="figs cash-figs">
          {[['EFECTIVO'], ['TARJETA'], ['BILLETERA']].map(([k]) => {
            const list = cobros.filter((t) => t.pago.metodo === k);
            return <div className="fig" key={k}><span>{METODOS_PAGO[k]} ({list.length})</span><b>{fmtSoles(total(list))}</b></div>;
          })}
          <div className="fig"><span>Total recaudado</span><b>{fmtSoles(total(cobros))}</b></div>
        </div>
        {(ver === 'cobros' ? cobros : sis).length ? (
          <ul className="queue">
            {(ver === 'cobros' ? cobros : sis).map((t) => (
              <li className="qrow" key={`${t.id}@${t.t0}`}>
                <TurnCode id={t.id} />
                <div className="qmain">
                  <span className="who">{fullName(patient(t.dni))}</span>
                  <span className="meta">
                    <span>{fmtT(t.pago.t)}</span>
                    {t.pago.comp && <span className="code">{t.pago.comp}</span>}
                    <span>{METODOS_PAGO[t.pago.metodo]}</span>
                  </span>
                </div>
                <div className="qside"><Badge tone={t.pago.monto ? 'ok' : 'mut'}>{fmtSoles(t.pago.monto)}</Badge></div>
                <div className="acts">{t.pago.comp && <button className="btn sec sm" onClick={() => docs.openPago(t)}><Receipt /> Boleta</button>}</div>
              </li>
            ))}
          </ul>
        ) : <Empty icon="scroll" title={ver === 'cobros' ? 'Aún no hay cobros hoy' : 'Aún no hay pacientes SIS hoy'} />}
        {ver === 'sis' && <Msg tone="info">Los asegurados al SIS (y los que esperan validación por contingencia) no pagan: Admisión los registra con un pago de S/ 0.00.</Msg>}
      </Panel>
      {docs.element}
      {dialog}
    </>
  );
}
