import { useState } from 'react';
import { useStore } from '../store/StoreProvider.jsx';
import { createTurn, cancelTurn, searchAudit, activeTurnOf, validatePatientForm } from '../store/actions.js';
import { ACTIVE_STATES, STATE } from '../lib/constants.js';
import { byArrival } from '../lib/clinical.js';
import { age, fmtT, fullName } from '../lib/format.js';
import { Card, Empty, Field, Msg, SisBadge, StateBadge, WaitTime, FlowSteps, Code, useConfirm } from '../components/ui.jsx';
import { useDocuments } from '../components/Documents.jsx';
import { useNow } from '../hooks/useNow.js';

const EMPTY_FORM = { nom: '', ape: '', nac: '', sexo: 'F', tel: '' };

/** Simula la consulta al servicio SIS (en producción: API externa con tiempo límite de 2,5 s). */
const sisLookup = (dni, patient, down) =>
  new Promise((resolve) => {
    setTimeout(() => {
      if (down) return resolve({ sis: 'PENDIENTE_VALIDACION', cont: true });
      if (patient) return resolve({ sis: patient.sis === 'PENDIENTE_VALIDACION' ? 'ACTIVO' : patient.sis, cont: false });
      const d = +dni.slice(-1);
      resolve({ sis: d <= 6 ? 'ACTIVO' : 'NO_ASEGURADO', cont: false });
    }, down ? 1500 : 500);
  });

export function Admision() {
  const { db, run } = useStore();
  const now = useNow();
  const docs = useDocuments();
  const [ask, dialog] = useConfirm();
  const [dni, setDni] = useState('');
  const [down, setDown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [found, setFound] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errs, setErrs] = useState({});
  const [filter, setFilter] = useState('todos');

  const dniOk = /^\d{8}$/.test(dni);

  const search = async (e) => {
    e.preventDefault();
    if (!dniOk) return;
    setLoading(true);
    const p = db.patients.find((x) => x.dni === dni);
    const res = await sisLookup(dni, p, down);
    setLoading(false);
    setFound({ dni, p, ...res });
    setForm(p ? { nom: p.nom, ape: p.ape, nac: p.nac, sexo: p.sexo, tel: p.tel } : EMPTY_FORM);
    setErrs({});
    run(searchAudit, dni);
  };

  const clear = () => {
    setFound(null);
    setDni('');
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
      docs.openTicket(r.result.id);
    }
  };

  const cancel = (t) =>
    ask({
      title: `Cancelar turno ${t.id}`,
      text: `${fullName(db.patients.find((p) => p.dni === t.dni))} saldrá de la cola. Esta acción no se puede deshacer.`,
      confirmLabel: 'Cancelar turno',
      danger: true,
      options: ['Anulado en admisión', 'Retiro voluntario del paciente', 'Registro duplicado'],
      onConfirm: (motivo) => run(cancelTurn, t.id, motivo),
    });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dup = found && activeTurnOf(db, found.dni);
  const isNew = found && !found.p;

  const active = db.turns.filter((t) => ACTIVE_STATES.includes(t.state)).sort(byArrival);
  const groups = {
    todos: active,
    triaje: active.filter((t) => ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'].includes(t.state)),
    consulta: active.filter((t) => ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'].includes(t.state)),
  };
  const list = groups[filter];

  return (
    <div className="content">
      <h1>Admisión</h1>
      <p className="sub">Identifique al paciente por DNI, verifique el SIS y genere el turno digital. Cada turno pasa a la lista de triaje.</p>

      <div className="grid">
        <Card title="1 · Búsqueda de paciente">
          <form onSubmit={search} className="search-row">
            <Field label="DNI (8 dígitos)" hint={dni && !dniOk ? `${dni.length}/8 dígitos` : undefined}>
              {(a) => (
                <input
                  {...a}
                  inputMode="numeric"
                  maxLength={8}
                  value={dni}
                  onChange={(e) => {
                    setDni(e.target.value.replace(/\D/g, ''));
                    setFound(null);
                  }}
                  placeholder="Ej. 70000001"
                  autoFocus
                />
              )}
            </Field>
            <button className="btn" disabled={!dniOk || loading}>{loading ? 'Validando SIS…' : 'Buscar'}</button>
          </form>
          <label className="check">
            <input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} />
            Simular caída del servicio de validación SIS
          </label>

          {loading && <div className="skeleton" aria-busy="true">Consultando el servicio SIS…</div>}

          {!loading && !found && (
            <Empty>
              Pruebe <button className="linkbtn" onClick={() => setDni('70000001')}>70000001</button> (con historia y alergia) o un DNI nuevo, p. ej.{' '}
              <button className="linkbtn" onClick={() => setDni('70000019')}>70000019</button>.
            </Empty>
          )}

          {!loading && found && (
            <form onSubmit={save} noValidate className="adm-form">
              {found.cont && (
                <Msg tone="warn">
                  <b>Modo contingencia (Regla 6):</b> el servicio SIS no respondió a tiempo. El turno se registra como «Pendiente de validación» para no detener la atención.
                </Msg>
              )}
              {dup && (
                <Msg tone="crit">
                  Este paciente ya tiene el turno <b>{dup.id}</b> activo ({STATE[dup.state][0].toLowerCase()}). No se genera otro.
                </Msg>
              )}
              <div className="patient-head">
                <div>
                  <b>{isNew ? 'Paciente nuevo' : fullName(found.p)}</b>
                  <small>{isNew ? 'Se creará su historia clínica.' : `${found.p.hc} · ${age(found.p.nac)} años`}</small>
                </div>
                <SisBadge sis={found.sis} />
              </div>
              {!isNew && found.p.alg && <Msg tone="crit"><b>Alergia registrada:</b> {found.p.alg}</Msg>}

              <div className="row">
                <Field label="Nombres" error={errs.nom}>
                  {(a) => <input {...a} value={form.nom} onChange={set('nom')} readOnly={!isNew} />}
                </Field>
                <Field label="Apellidos" error={errs.ape}>
                  {(a) => <input {...a} value={form.ape} onChange={set('ape')} readOnly={!isNew} />}
                </Field>
              </div>
              <div className="row s">
                <Field label="Fecha de nacimiento" error={errs.nac}>
                  {(a) => <input {...a} type="date" value={form.nac} onChange={set('nac')} readOnly={!isNew} max={new Date().toISOString().slice(0, 10)} />}
                </Field>
                <Field label="Sexo">
                  {(a) => (
                    <select {...a} value={form.sexo} onChange={set('sexo')} disabled={!isNew}>
                      <option value="F">Femenino</option>
                      <option value="M">Masculino</option>
                    </select>
                  )}
                </Field>
                <Field label="Teléfono" error={errs.tel}>
                  {(a) => <input {...a} value={form.tel} onChange={set('tel')} inputMode="tel" />}
                </Field>
              </div>
              <div className="actions">
                <button className="btn" disabled={!!dup}>Generar turno</button>
                {!isNew && <button type="button" className="btn sec" onClick={() => docs.openHC(found.dni)}>Ver historia clínica</button>}
                <button type="button" className="btn ghost" onClick={clear}>Limpiar</button>
              </div>
            </form>
          )}
        </Card>

        <Card
          title={`Turnos activos (${active.length})`}
          actions={
            <div className="seg" role="tablist" aria-label="Filtrar turnos">
              {[['todos', 'Todos'], ['triaje', 'Triaje'], ['consulta', 'Consulta']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                  {l} <span>{groups[k].length}</span>
                </button>
              ))}
            </div>
          }
        >
          <div className="list">
            {list.length ? list.map((t) => {
              const p = db.patients.find((x) => x.dni === t.dni);
              return (
                <div className="item" key={t.id}>
                  <div className="l">
                    <span><Code>{t.id}</Code> · {fullName(p)}</span>
                    <small>DNI {p.dni} · llegó {fmtT(t.t0)} · <WaitTime turn={t} now={now} /></small>
                    <FlowSteps state={t.state} />
                  </div>
                  <StateBadge state={t.state} />
                  <div className="item-a">
                    <button className="btn sec sm" onClick={() => docs.openTicket(t.id)}>Ticket</button>
                    {['EN_ESPERA_TRIAJE', 'EN_ESPERA_CONSULTA'].includes(t.state) && (
                      <button className="btn dng sm" onClick={() => cancel(t)}>Cancelar</button>
                    )}
                  </div>
                </div>
              );
            }) : <Empty>Sin turnos en esta lista.</Empty>}
          </div>
        </Card>
      </div>
      {docs.element}
      {dialog}
    </div>
  );
}
