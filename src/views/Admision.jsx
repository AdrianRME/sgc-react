import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Ban, Check, LogIn, Search, Ticket as TicketIcon, WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { createTurn, cancelTurn, checkIn, searchAudit, activeTurnOf, validatePatientForm } from '../store/actions.js';
import { ACTIVE_STATES, CANCEL, ROUTE, SIS_EXONERADO, STATE, TARIFA_CONSULTA } from '../lib/constants.js';
import { sameDay } from '../lib/agenda.js';
import { byArrival, normalize } from '../lib/clinical.js';
import { age, cap, fmtCitaDia, fmtLongDay, fmtSoles, fmtT, fmtHora, fullName, iniciales as initials, isoDay, saludo } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { Empty, Field, Msg, Panel, SisBadge, StateBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { useCitaAcciones } from '../hooks/useCitaAcciones.jsx';
import { CitaRow } from '../components/CitaForm.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { SectionHero } from '../components/SectionHero.jsx';
import './workspaces.css';

const EMPTY_FORM = { nom: '', ape: '', nac: '', sexo: 'F', tel: '' };
/** Pacientes que están en el centro (los citados para otro día se ven en la sección de citas). */
const EN_CENTRO = ACTIVE_STATES.filter((s) => s !== 'CITADO');
const CANCELABLE = ['PENDIENTE_PAGO', 'EN_ESPERA_TRIAJE', 'PENDIENTE_CITA', 'EN_ESPERA_CONSULTA'];

/** Simula la consulta al servicio SIS (en producción: API externa con tiempo límite de 2,5 s). */
const sisLookup = (dni, patient, down) =>
  new Promise((resolve) => {
    setTimeout(() => {
      if (down) return resolve({ sis: 'PENDIENTE_VALIDACION', cont: true });
      if (patient) return resolve({ sis: patient.sis === 'PENDIENTE_VALIDACION' ? 'ACTIVO' : patient.sis, cont: false });
      resolve({ sis: +dni.slice(-1) <= 6 ? 'ACTIVO' : 'NO_ASEGURADO', cont: false });
    }, down ? 1500 : 500);
  });

const PASOS = ['Identificar', 'Verificar seguro', 'Generar turno'];

/** Los tres pasos de la ventanilla (RF-02, RF-03 y RF-05 del informe), con el actual resaltado. */
function Pasos({ paso }) {
  return (
    <ol className="adm-steps" aria-label="Pasos del registro">
      {PASOS.map((n, i) => (
        <li key={n} className={i < paso ? 'done' : i === paso ? 'cur' : ''} aria-current={i === paso ? 'step' : undefined}>
          <b>{i < paso ? <Check aria-hidden="true" /> : i + 1}</b>
          <span>{n}</span>
        </li>
      ))}
    </ol>
  );
}

const SEXO = { F: 'Mujer', M: 'Hombre' };
// Casos de prueba de la demostración
const EJEMPLOS = [['70000001', 'Con historia y alergia'], ['70000013', 'Nuevo con SIS'], ['70000027', 'Sin seguro']];

/** Registro: búsqueda por DNI (o apellido), validación SIS y generación del turno. */
function Registro() {
  const { db, run, patient } = useStore();
  const docs = useDocuments();
  const [q, setQ] = useState('');
  const [down, setDown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errs, setErrs] = useState({});
  const now = useNow(60_000);
  const [today] = useState(() => isoDay(Date.now()));
  const dniOk = /^\d{8}$/.test(q);
  const byName = !/^\d+$/.test(q) && q.trim().length >= 3;
  const nq = normalize(q.trim());
  const matches = byName ? db.patients.filter((p) => normalize(fullName(p)).includes(nq)).slice(0, 6) : [];

  const lookup = async (dni) => {
    setLoading(true);
    const p = patient(dni);
    const res = await sisLookup(dni, p, down);
    setLoading(false);
    setFound({ dni, p, ...res });
    setForm(p ? { nom: p.nom, ape: p.ape, nac: p.nac, sexo: p.sexo, tel: p.tel } : EMPTY_FORM);
    setErrs({});
    run(searchAudit, dni);
  };
  const clear = () => {
    setFound(null);
    setQ('');
    setErrs({});
  };
  const save = async (e) => {
    e.preventDefault();
    if (!found.p) {
      const v = validatePatientForm(form);
      setErrs(v);
      if (Object.keys(v).length) return;
    }
    const r = await run(createTurn, { dni: found.dni, form, sis: found.sis });
    if (r.ok) {
      clear();
      docs.openTicket(r.result);
    }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dup = found && activeTurnOf(db, found.dni);
  const isNew = found && !found.p;
  const exonerado = found && SIS_EXONERADO.includes(found.sis);
  const paso = found ? 2 : loading ? 1 : 0;

  return (
    <Panel
      title="Registro de paciente"
      className="adm-reg"
      icon="idcard"
      actions={(
        <label className="sis-test" title="Simula que el servicio del SIS no responde (modo contingencia, Regla 6)">
          <input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} />
          <WifiOff aria-hidden="true" /> Probar SIS caído
        </label>
      )}
    >
      <Pasos paso={paso} />
      <form onSubmit={(e) => { e.preventDefault(); if (dniOk) lookup(q); }} className="adm-search">
        <label htmlFor="adm-q" className="sr-only">DNI o apellido del paciente</label>
        <Search aria-hidden="true" />
        <input
          id="adm-q"
          value={q}
          maxLength={40}
          onChange={(e) => {
            const v = e.target.value;
            setQ(/^\d/.test(v) ? v.replace(/\D/g, '').slice(0, 8) : v); // números: DNI; letras: apellido
            setFound(null);
          }}
          placeholder="DNI (8 dígitos) o apellido"
          autoFocus
          autoComplete="off"
        />
        <span className="adm-count" aria-live="polite">{/^\d+$/.test(q) && !dniOk ? `${q.length}/8` : ''}</span>
        <button className="btn" disabled={!dniOk || loading}>Buscar</button>
      </form>

      {byName && !found && (
        matches.length ? (
          <ul className="matches" aria-label="Pacientes encontrados">
            {matches.map((p) => (
              <li key={p.dni}>
                <button type="button" onClick={() => { setQ(p.dni); lookup(p.dni); }}>
                  <span className="mini-av" aria-hidden="true">{initials(p)}</span>
                  <span><b>{fullName(p)}</b><small>DNI {p.dni} · {age(p.nac)} años · {p.hc}</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="note">Nadie registrado con ese apellido. Busque por DNI para registrarlo.</p>
      )}

      {loading && (
        <div className="sis-check" role="status">
          <Icon3D name="shield" size={36} />
          <span><b>Consultando el SIS…</b><small>DNI {q}</small></span>
        </div>
      )}

      {!loading && !found && !byName && (
        <div className="adm-empty">
          <Icon3D name="idcard" size={64} />
          <p>Pida el DNI al paciente y búsquelo.</p>
          <div className="adm-ex">
            {EJEMPLOS.map(([dni, n]) => (
              <button key={dni} type="button" className="ex-chip" onClick={() => setQ(dni)}><b>{dni}</b>{n}</button>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!loading && found && (
          <m.form key={found.dni} {...listItem} onSubmit={save} noValidate className="stack">
            {found.cont && (
              <Msg tone="warn"><b>SIS sin respuesta (Regla 6).</b> El turno se registra como «Pendiente de validación» para no detener la atención.</Msg>
            )}

            <div className={`ficha ${isNew ? 'new' : ''}`}>
              <span className="ficha-av" aria-hidden="true">{isNew ? <Icon3D name="sparkles" size={34} /> : initials(found.p)}</span>
              <div className="ficha-main">
                <b>{isNew ? 'Paciente nuevo' : fullName(found.p)}</b>
                <ul className="ficha-tags">
                  <li>DNI {found.dni}</li>
                  {isNew ? <li>Se abrirá su historia clínica</li> : (
                    <>
                      <li>{age(found.p.nac)} años</li>
                      <li>{SEXO[found.p.sexo]}</li>
                      <li>{found.p.hc}</li>
                    </>
                  )}
                </ul>
              </div>
              <SisBadge sis={found.sis} />
            </div>
            {!isNew && found.p.alg && (
              <div className="ficha-alg" role="alert"><Icon3D name="warning" size={22} /><span><b>Alergia:</b> {found.p.alg}</span></div>
            )}

            {dup && dup.state === 'CITADO' ? (
              <Msg tone={sameDay(dup.cita.at, now) ? 'ok' : 'info'}>
                Tiene cita <b>{fmtCitaDia(dup.cita.at, now)} a las {fmtHora(dup.cita.at)}</b> (turno {dup.id}).{' '}
                {dup.tTriSave ? 'No paga ni pasa por triaje otra vez.' : `La reservó por ${dup.cita.by === 'a.citasweb' ? 'la web' : 'teléfono'}: al llegar ${SIS_EXONERADO.includes(found.sis) ? 'pasa a triaje (SIS)' : 'paga en Caja y pasa a triaje'} y luego a su médico.`}
                {sameDay(dup.cita.at, now)
                  ? <div className="actions"><button type="button" className="btn sm" onClick={async () => { const r = await run(checkIn, dup.id); if (r.ok) { clear(); if (r.result?.state !== 'EN_ESPERA_CONSULTA') docs.openTicket(r.result); } }}><LogIn /> Registrar llegada</button></div>
                  : ' Ese día registre su llegada aquí.'}
              </Msg>
            ) : dup ? (
              <Msg tone="crit">Ya tiene el turno <b>{dup.id}</b> activo ({STATE[dup.state][0].toLowerCase()}). No se genera otro.</Msg>
            ) : (
              <div className="next-step" data-role={exonerado ? 'enf' : 'caj'}>
                <Icon3D name={exonerado ? 'thermometer' : 'scroll'} size={34} />
                <span>
                  <small>Siguiente paso</small>
                  <b>{exonerado ? 'Triaje · sin pago (SIS)' : `Caja · pagar ${fmtSoles(TARIFA_CONSULTA)}`}</b>
                </span>
              </div>
            )}

            {dup ? null : isNew ? (
              <fieldset className="adm-form">
                <legend>Datos del paciente</legend>
                <div className="row">
                  <Field label="Nombres" error={errs.nom}>{(a) => <input {...a} value={form.nom} onChange={set('nom')} autoFocus />}</Field>
                  <Field label="Apellidos" error={errs.ape}>{(a) => <input {...a} value={form.ape} onChange={set('ape')} />}</Field>
                </div>
                <div className="row">
                  <Field label="Fecha de nacimiento" error={errs.nac}>
                    {(a) => <input {...a} type="date" value={form.nac} onChange={set('nac')} max={today} />}
                  </Field>
                  <Field label="Sexo">
                    {(a) => (
                      <select {...a} value={form.sexo} onChange={set('sexo')}>
                        <option value="F">Femenino</option>
                        <option value="M">Masculino</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Teléfono (opcional)" error={errs.tel}>{(a) => <input {...a} value={form.tel} onChange={set('tel')} inputMode="tel" />}</Field>
                </div>
              </fieldset>
            ) : (
              <Field label="Teléfono de contacto" error={errs.tel}>{(a) => <input {...a} value={form.tel} onChange={set('tel')} inputMode="tel" />}</Field>
            )}

            <div className="actions">
              {!dup && <button className="btn lg"><TicketIcon /> Generar turno</button>}
              <button type="button" className="btn ghost" onClick={clear}>Limpiar</button>
            </div>
          </m.form>
        )}
      </AnimatePresence>
      {docs.element}
    </Panel>
  );
}

/**
 * Filtros de la ventanilla, en el orden de la ruta. Cada tarjeta del encabezado cuenta sus pacientes y, al
 * pulsarla, muestra la lista a la derecha. «Sin cita» son los que Enfermería dejó para Admisión.
 */
const FILTROS = [
  { k: 'llegan', n: 'Citados por llegar', icon: 'calendar', c: 'adm', of: (t, now) => t.state === 'CITADO' && sameDay(t.cita.at, now) },
  { k: 'caj', n: 'Por pagar', icon: 'scroll', c: 'caj', of: (t) => t.state === 'PENDIENTE_PAGO' },
  { k: 'enf', n: 'En triaje', icon: 'thermometer', c: 'enf', of: (t) => ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'].includes(t.state) },
  { k: 'cita', n: 'Sin cita', icon: 'clipboard', c: 'adm', of: (t) => t.state === 'PENDIENTE_CITA' },
  { k: 'med', n: 'En consulta', icon: 'stethoscope', c: 'med', of: (t) => ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'].includes(t.state) },
  { k: 'todos', n: 'En el centro', icon: 'hospital', c: 'jef', of: (t) => EN_CENTRO.includes(t.state) },
];
const SUB = {
  llegan: 'Tienen cita hoy: al presentarse, registre su llegada y pasan directo a su médico.',
  caj: 'Deben pagar en Caja antes del triaje.',
  enf: 'Esperan o están en triaje. Allí mismo reciben su cita.',
  cita: 'Terminaron el triaje sin cita: asígnela en «Asignar citas».',
  med: 'Con cita para hoy: esperan o están con su médico.',
  todos: 'Todos los pacientes que están hoy en el centro.',
};
const estacion = (state) => ROUTE.find((s) => s.states.includes(state));


/** Lista de pacientes del filtro elegido: tarjetas con el color de la estación donde está cada uno. */
function Pacientes({ filter, lists }) {
  const { run, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const citas = useCitaAcciones();
  const [ask, dialog] = useConfirm();
  const f = FILTROS.find((x) => x.k === filter);
  const list = lists[filter];
  const pat = (t) => patient(t.dni);
  const cancel = (t) =>
    ask({
      title: `Cancelar el turno ${t.id}`,
      text: `${fullName(pat(t))} saldrá de la cola. Esta acción no se puede deshacer.`,
      confirmLabel: 'Cancelar turno',
      danger: true,
      options: t.state === 'PENDIENTE_PAGO' ? [CANCEL.sinPago, CANCEL.anulado, CANCEL.duplicado] : [CANCEL.anulado, CANCEL.retiro, CANCEL.duplicado],
      onConfirm: (motivo) => run(cancelTurn, t.id, motivo),
    });

  return (
    <Panel title={f.n} count={list.length} icon={f.icon} sub={SUB[filter]} className="adm-list" data-role={f.c}>
      {!list.length ? (
        <Empty icon={filter === 'llegan' ? 'calendar' : 'check'} title={filter === 'llegan' ? 'No quedan citados por llegar hoy' : 'Nadie en esta etapa'} />
      ) : filter === 'llegan' ? (
        <ul className="cita-list one">
          <AnimatePresence initial={false}>
            {list.map((t) => <CitaRow key={t.id} t={t} now={now} actions={citas.acts(t)} />)}
          </AnimatePresence>
        </ul>
      ) : (
        <ul className="pacs">
          <AnimatePresence initial={false}>
            {list.map((t) => {
              const p = pat(t);
              const st = estacion(t.state);
              return (
                <m.li key={t.id} {...listItem} layout className="pac" style={{ '--c': `var(--st-${st?.c ?? 'adm'})` }}>
                  <span className="pac-av" aria-hidden="true">{p ? initials(p) : '?'}</span>
                  <div className="pac-main">
                    <b>{fullName(p)}</b>
                    <span className="pac-meta">
                      <TurnCode id={t.id} />
                      <span className="pac-st">{st?.n}</span>
                      <WaitTime turn={t} now={now} />
                    </span>
                  </div>
                  <StateBadge state={t.state} />
                  <div className="pac-acts">
                    <button type="button" className="icon-btn sm" onClick={() => docs.openTicket(t)} aria-label={`Ticket de ${t.id}`} title="Ver o imprimir el ticket"><TicketIcon /></button>
                    {CANCELABLE.includes(t.state) && (
                      <button type="button" className="icon-btn sm dng" onClick={() => cancel(t)} aria-label={`Cancelar ${t.id}`} title="Cancelar el turno"><Ban /></button>
                    )}
                  </div>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {docs.element}
      {citas.element}
      {dialog}
    </Panel>
  );
}

export default function Admision() {
  const { db, user } = useStore();
  const now = useNow();
  const lists = Object.fromEntries(FILTROS.map((f) => [f.k, db.turns.filter((t) => f.of(t, now)).sort(f.k === 'llegan' ? (a, b) => a.cita.at - b.cita.at : byArrival)]));
  const counts = Object.fromEntries(FILTROS.map((f) => [f.k, lists[f.k].length]));
  const [filter, setFilter] = useState(() => (counts.llegan ? 'llegan' : 'todos'));
  return (
    <>
      <SectionHero
        icon="idcard"
        kicker={`${cap(fmtLongDay(now))} · ${fmtT(now)}`}
        title={`${saludo(now)}, ${user.n.split(' ')[0]}`}
        text="Ventanilla de Admisión: identifique al paciente, verifique su seguro y entréguele su turno."
        tiles={FILTROS.map((f) => ({ ...f, value: counts[f.k] }))}
        active={filter}
        onPick={setFilter}
        label="Pacientes por etapa"
      />
      <div className="grid-2 adm-grid">
        <Registro />
        <Pacientes filter={filter} lists={lists} />
      </div>
    </>
  );
}
