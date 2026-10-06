import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Ban, Search, Ticket as TicketIcon, UserRound, WifiOff } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { createTurn, cancelTurn, searchAudit, activeTurnOf, validatePatientForm } from '../store/actions.js';
import { ACTIVE_STATES, CANCEL, ROUTE, STATE } from '../lib/constants.js';
import { byArrival, normalize } from '../lib/clinical.js';
import { age, fmtT, fullName, isoDay } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { WorkspaceHeader } from '../components/WorkspaceHeader.jsx';
import { Empty, Field, MiniRoute, Msg, Panel, Segmented, SisBadge, StateBadge, TurnCode, WaitTime } from '../components/ui.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import { useDocuments } from '../hooks/useDocuments.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import './workspaces.css';

const EMPTY_FORM = { nom: '', ape: '', nac: '', sexo: 'F', tel: '' };
const TRIAGE = ROUTE.find((s) => s.k === 'enf').states;

/** Simula la consulta al servicio SIS (en producción: API externa con tiempo límite de 2,5 s). */
const sisLookup = (dni, patient, down) =>
  new Promise((resolve) => {
    setTimeout(() => {
      if (down) return resolve({ sis: 'PENDIENTE_VALIDACION', cont: true });
      if (patient) return resolve({ sis: patient.sis === 'PENDIENTE_VALIDACION' ? 'ACTIVO' : patient.sis, cont: false });
      resolve({ sis: +dni.slice(-1) <= 6 ? 'ACTIVO' : 'NO_ASEGURADO', cont: false });
    }, down ? 1500 : 500);
  });

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

  return (
    <Panel title="Registro de paciente" icon="idcard" sub="Busque por DNI; si no recuerda el número, escriba el apellido">
      <form onSubmit={(e) => { e.preventDefault(); if (dniOk) lookup(q); }} className="search-row">
        <Field label="DNI o apellido" hint={/^\d+$/.test(q) && !dniOk ? `${q.length} de 8 dígitos` : undefined}>
          {(a) => (
            <div className="search-in">
              <Search aria-hidden="true" />
              <input
                {...a}
                value={q}
                maxLength={40}
                onChange={(e) => {
                  const v = e.target.value;
                  setQ(/^\d/.test(v) ? v.replace(/\D/g, '').slice(0, 8) : v); // números: DNI; letras: apellido
                  setFound(null);
                }}
                placeholder="Ej. 70000001 o Paredes"
                autoFocus
                autoComplete="off"
              />
            </div>
          )}
        </Field>
        <button className="btn" disabled={!dniOk || loading}>{loading ? 'Validando SIS…' : 'Buscar'}</button>
      </form>
      <label className="check">
        <input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} />
        <WifiOff size={15} aria-hidden="true" /> Simular caída del servicio de validación SIS
      </label>

      {byName && !found && (
        matches.length ? (
          <ul className="matches" aria-label="Pacientes encontrados">
            {matches.map((p) => (
              <li key={p.dni}>
                <button type="button" onClick={() => { setQ(p.dni); lookup(p.dni); }}>
                  <UserRound aria-hidden="true" />
                  <span><b>{fullName(p)}</b><small>DNI {p.dni}, {age(p.nac)} años, {p.hc}</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="note">Ningún paciente registrado con ese nombre. Busque por DNI para registrarlo.</p>
      )}

      {loading && <div className="skeleton" style={{ height: 120 }} aria-busy="true" />}

      {!loading && !found && !byName && (
        <Empty icon="search" title="Busque al paciente para generar su turno">
          Pruebe <button className="linkbtn" onClick={() => setQ('70000001')}>70000001</button> (con historia y alergia) o un DNI nuevo, por ejemplo{' '}
          <button className="linkbtn" onClick={() => setQ('70000019')}>70000019</button>.
        </Empty>
      )}

      <AnimatePresence mode="wait">
        {!loading && found && (
          <m.form key={found.dni} {...listItem} onSubmit={save} noValidate className="stack">
            {found.cont && (
              <Msg tone="warn"><b>Modo contingencia (Regla 6):</b> el servicio SIS no respondió a tiempo. El turno se registra como «Pendiente de validación» para no detener la atención.</Msg>
            )}
            {dup && <Msg tone="crit">Este paciente ya tiene el turno <b>{dup.id}</b> activo ({STATE[dup.state][0].toLowerCase()}). No se genera otro.</Msg>}
            <div className="patient-card">
              <Icon3D name={isNew ? 'sparkles' : 'idcard'} size={44} />
              <div className="pc-main">
                <b>{isNew ? 'Paciente nuevo' : fullName(found.p)}</b>
                <small>{isNew ? 'Se abrirá su historia clínica al generar el turno.' : `${found.p.hc}, ${age(found.p.nac)} años, DNI ${found.dni}`}</small>
              </div>
              <SisBadge sis={found.sis} />
            </div>
            {!isNew && found.p.alg && <Msg tone="crit"><b>Alergia registrada:</b> {found.p.alg}</Msg>}
            <div className="row">
              <Field label="Nombres" error={errs.nom}>{(a) => <input {...a} value={form.nom} onChange={set('nom')} readOnly={!isNew} />}</Field>
              <Field label="Apellidos" error={errs.ape}>{(a) => <input {...a} value={form.ape} onChange={set('ape')} readOnly={!isNew} />}</Field>
            </div>
            <div className="row">
              <Field label="Fecha de nacimiento" error={errs.nac}>
                {(a) => <input {...a} type="date" value={form.nac} onChange={set('nac')} readOnly={!isNew} max={today} />}
              </Field>
              <Field label="Sexo">
                {(a) => (
                  <select {...a} value={form.sexo} onChange={set('sexo')} disabled={!isNew}>
                    <option value="F">Femenino</option>
                    <option value="M">Masculino</option>
                  </select>
                )}
              </Field>
              <Field label="Teléfono" error={errs.tel}>{(a) => <input {...a} value={form.tel} onChange={set('tel')} inputMode="tel" />}</Field>
            </div>
            <div className="actions">
              <button className="btn lg" disabled={!!dup}><TicketIcon /> Generar turno</button>
              <button type="button" className="btn ghost" onClick={clear}>Limpiar</button>
            </div>
          </m.form>
        )}
      </AnimatePresence>
      {docs.element}
    </Panel>
  );
}

/** Turnos activos: dónde está cada paciente, con su ticket y la opción de cancelar. */
function Activos() {
  const { db, run, patient } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [filter, setFilter] = useState('todos');
  const active = db.turns.filter((t) => ACTIVE_STATES.includes(t.state)).sort(byArrival);
  const groups = {
    todos: active,
    triaje: active.filter((t) => TRIAGE.includes(t.state)),
    consulta: active.filter((t) => !TRIAGE.includes(t.state)),
  };
  const pat = (t) => patient(t.dni);
  const cancel = (t) =>
    ask({
      title: `Cancelar el turno ${t.id}`,
      text: `${fullName(pat(t))} saldrá de la cola. Esta acción no se puede deshacer.`,
      confirmLabel: 'Cancelar turno',
      danger: true,
      options: [CANCEL.anulado, CANCEL.retiro, CANCEL.duplicado],
      onConfirm: (motivo) => run(cancelTurn, t.id, motivo),
    });

  return (
    <Panel
      title="Turnos activos"
      count={active.length}
      icon="clipboard"
      actions={<Segmented label="Filtrar turnos" value={filter} onChange={setFilter} options={[['todos', 'Todos', groups.todos.length], ['triaje', 'Triaje', groups.triaje.length], ['consulta', 'Consulta', groups.consulta.length]]} />}
    >
      {groups[filter].length ? (
        <ul className="queue">
          <AnimatePresence initial={false}>
            {groups[filter].map((t) => {
              const p = pat(t);
              return (
                <m.li key={t.id} {...listItem} layout className="qrow">
                  <TurnCode id={t.id} />
                  <div className="qmain">
                    <span className="who">{fullName(p)}</span>
                    <span className="meta">
                      <span>DNI {p?.dni}</span>
                      <span>llegó {fmtT(t.t0)}</span>
                      <WaitTime turn={t} now={now} />
                      <MiniRoute state={t.state} />
                    </span>
                  </div>
                  <div className="qside"><StateBadge state={t.state} /></div>
                  <div className="acts">
                    <button className="btn sec sm" onClick={() => docs.openTicket(t)}><TicketIcon /> Ticket</button>
                    {['EN_ESPERA_TRIAJE', 'EN_ESPERA_CONSULTA'].includes(t.state) && (
                      <button className="btn dng sm" onClick={() => cancel(t)}><Ban /> Cancelar</button>
                    )}
                  </div>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ul>
      ) : <Empty icon="check" title="Sin turnos en esta lista" />}
      {docs.element}
      {dialog}
    </Panel>
  );
}

export default function Admision() {
  return (
    <>
      <WorkspaceHeader title="Registro y turnos" route figs />
      <div className="grid-2">
        <Registro />
        <Activos />
      </div>
    </>
  );
}
