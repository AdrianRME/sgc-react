import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowLeft, CalendarCheck, Check, LogIn, Printer, Search } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { ESPECIALIDADES } from '../lib/constants.js';
import { agendaPublica as agendaDe, cuposLibres, diasDeAtencion, listaDias, porDia } from '../lib/agenda.js';
import { fmtCitaDia, fmtHora, fmtLongDay, isoDay } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { Field, Msg } from '../components/ui.jsx';
import { Icon3D } from '../components/Icon3D.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import './citaweb.css';

const ESP_ICON = { MG: 'stethoscope', PED: 'nurse', CAR: 'heart' };
const DAYS_SHOWN = 10;
const PASOS = ['Identifíquese', 'Especialidad', 'Día y hora', 'Listo'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Constancia de la cita reservada (o de la que ya tenía). */
function Constancia({ act, now, titulo }) {
  const c = act.cita;
  return (
    <div className="cw-const" style={{ '--e': `var(--esp-${c.esp})` }}>
      <div className="cw-const-h">
        <CalendarCheck aria-hidden="true" />
        <span><small>{titulo}</small><b>{act.id}</b></span>
      </div>
      <div className="cw-const-b">
        <div className="cw-hora"><b>{fmtHora(c.at)}</b><span>{cap(fmtLongDay(c.at))}</span></div>
        <dl>
          <div><dt>Especialidad</dt><dd>{ESPECIALIDADES.find((e) => e.k === c.esp)?.n}</dd></div>
          <div><dt>Médico</dt><dd>{c.medico}</dd></div>
          <div><dt>Consultorio</dt><dd>{c.area}</dd></div>
        </dl>
      </div>
      <ol className="cw-guia">
        <li>Ese día preséntese en <b>Admisión</b> con su DNI 15 minutos antes de su hora.</li>
        <li>Si no tiene SIS, pague la consulta en <b>Caja</b>.</li>
        <li>Pase por <b>Triaje</b>: luego lo atiende su médico a su hora{fmtCitaDia(c.at, now) === 'hoy' ? ', hoy mismo' : ''}.</li>
      </ol>
    </div>
  );
}

/**
 * Reserva de cita por la web (el paciente, sin sesión) o por teléfono (Admisión, con su sesión). Pide DNI y
 * fecha de nacimiento; solo pacientes con historia y una sola cita a la vez. El cupo sale del horario del
 * médico, igual que en Admisión; la base vuelve a validar todo al reservar.
 */
export function ReservaCita({ telefono = false, onDone }) {
  const { repo, reload } = useStore();
  const now = useNow(60_000);
  const [paso, setPaso] = useState(0);
  const [dni, setDni] = useState('');
  const [nac, setNac] = useState('');
  const [pac, setPac] = useState(null);
  const [esp, setEsp] = useState(null);
  const [agenda, setAgenda] = useState(null);
  const [med, setMed] = useState('');
  const [day, setDay] = useState(null);
  const [pick, setPick] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const tarea = async (fn) => {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const identificar = (e) => {
    e.preventDefault();
    tarea(async () => {
      const r = await repo.pacienteCita(dni, nac);
      setPac(r);
      setPaso(r.activa ? 3 : 1);
    });
  };
  const elegirEsp = (k) => tarea(async () => {
    setEsp(k);
    setMed('');
    setDay(null);
    setPick(null);
    setAgenda(agendaDe(await repo.cupos(k)));
    setPaso(2);
  });
  const reservar = () => tarea(async () => {
    const r = await repo.reservarCita(dni, nac, { esp, med: pick.med, at: pick.at });
    setHecho(r);
    setPaso(3);
    reload?.();
    onDone?.(r);
  });
  const reiniciar = () => {
    setPaso(0); setDni(''); setNac(''); setPac(null); setEsp(null); setAgenda(null); setPick(null); setHecho(null); setErr('');
  };

  const dias = agenda ? porDia(cuposLibres(agenda, esp, now, { med: med || null, dias: 30 })).slice(0, DAYS_SHOWN) : [];
  const curDay = dias.find((d) => d.day === day) ?? dias[0];
  const docName = (u) => agenda?.users.find((x) => x.u === u)?.n ?? u;
  const yaTenia = paso === 3 && !hecho && pac?.activa;

  return (
    <div className={`cw-box ${telefono ? 'tel' : ''}`}>
      <ol className="cw-steps" aria-label="Pasos de la reserva">
        {PASOS.map((n, i) => (
          <li key={n} className={i < paso ? 'done' : i === paso ? 'cur' : ''} aria-current={i === paso ? 'step' : undefined}>
            <b>{i < paso ? <Check aria-hidden="true" /> : i + 1}</b><span>{n}</span>
          </li>
        ))}
      </ol>
      {err && <Msg tone="crit">{err}</Msg>}

      <AnimatePresence mode="wait">
        {paso === 0 && (
          <m.form key="id" {...listItem} onSubmit={identificar} className="stack" noValidate>
            <p className="cw-lead">{telefono
              ? 'Pida al paciente su DNI y su fecha de nacimiento. Solo pacientes con historia clínica en el centro.'
              : 'Ingrese su DNI y su fecha de nacimiento. Si es su primera atención, acérquese a Admisión para abrir su historia clínica.'}</p>
            <div className="row">
              <Field label="DNI">
                {(a) => <input {...a} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="8 dígitos" autoComplete="off" autoFocus />}
              </Field>
              <Field label="Fecha de nacimiento">
                {(a) => <input {...a} type="date" value={nac} onChange={(e) => setNac(e.target.value)} max={isoDay(now)} />}
              </Field>
            </div>
            <button className="btn lg" disabled={busy || dni.length !== 8 || !nac}><Search /> {busy ? 'Buscando…' : 'Continuar'}</button>
          </m.form>
        )}

        {paso === 1 && (
          <m.div key="esp" {...listItem} className="stack">
            <p className="cw-lead">Hola, <b>{pac.nom}</b>. ¿Con qué especialidad desea su cita?</p>
            <div className="cw-esps">
              {ESPECIALIDADES.map((e) => (
                <button key={e.k} type="button" className="cw-esp" style={{ '--e': `var(--esp-${e.k})` }} onClick={() => elegirEsp(e.k)} disabled={busy}>
                  <Icon3D name={ESP_ICON[e.k] || 'stethoscope'} size={44} />
                  <b>{e.n}</b>
                  <small>Citas de {e.dur} min</small>
                </button>
              ))}
            </div>
          </m.div>
        )}

        {paso === 2 && agenda && (
          <m.div key="cupo" {...listItem} className="stack">
            <div className="cw-bar">
              <button type="button" className="btn ghost sm" onClick={() => setPaso(1)}><ArrowLeft /> Especialidad</button>
              <span className="cw-esp-pill" style={{ '--e': `var(--esp-${esp})` }}>{ESPECIALIDADES.find((e) => e.k === esp)?.n}</span>
              <span className="note">Atiende los {listaDias(diasDeAtencion(agenda, esp))}</span>
            </div>
            {agenda.users.length > 1 && (
              <Field label="Médico">
                {(a) => (
                  <select {...a} value={med} onChange={(e) => { setMed(e.target.value); setDay(null); setPick(null); }}>
                    <option value="">Cualquiera (primer cupo libre)</option>
                    {agenda.users.map((u) => <option key={u.u} value={u.u}>{u.n}</option>)}
                  </select>
                )}
              </Field>
            )}
            {dias.length ? (
              <>
                <div className="day-chips" role="group" aria-label="Día de la cita">
                  {dias.map((d) => (
                    <button key={d.day} type="button" className={`chip ${curDay?.day === d.day ? 'on' : ''}`} aria-pressed={curDay?.day === d.day} onClick={() => { setDay(d.day); setPick(null); }}>
                      <b>{cap(fmtCitaDia(d.day, now))}</b><small>{d.cupos.length} cupos</small>
                    </button>
                  ))}
                </div>
                <div className="slots" role="group" aria-label="Hora de la cita">
                  {curDay?.cupos.map((c) => {
                    const on = pick?.at === c.at && pick?.med === c.med;
                    return (
                      <button key={`${c.med}-${c.at}`} type="button" className={`slot ${on ? 'on' : ''}`} aria-pressed={on} title={docName(c.med)} onClick={() => setPick(c)}>
                        <b>{fmtHora(c.at)}</b><small>{docName(c.med).replace(/\s*\(demo\)/, '').split(' ').slice(0, 2).join(' ')}</small>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : <Msg tone="warn">No quedan cupos libres en los próximos 30 días. Llame o acérquese a Admisión.</Msg>}
            {pick && (
              <div className="pick-sum">
                <CalendarCheck aria-hidden="true" />
                <span><b>{cap(fmtCitaDia(pick.at, now))} a las {fmtHora(pick.at)}</b> con {docName(pick.med)}, {pick.area}</span>
                <button type="button" className="btn" onClick={reservar} disabled={busy}>{busy ? 'Reservando…' : 'Reservar cita'}</button>
              </div>
            )}
          </m.div>
        )}

        {paso === 3 && (
          <m.div key="ok" {...listItem} className="stack">
            {yaTenia ? (
              <>
                <Msg tone="info">Hola, <b>{pac.nom}</b>. Ya tiene {pac.activa.cita ? 'una cita pendiente' : `un turno activo (${pac.activa.id})`}. Solo puede tener una a la vez: si necesita cambiarla, llame o acérquese a Admisión.</Msg>
                {pac.activa.cita && <Constancia act={pac.activa} now={now} titulo="Su cita" />}
              </>
            ) : hecho && (
              <>
                <Msg tone="ok">Cita reservada. Guarde o imprima esta constancia.</Msg>
                <Constancia act={hecho} now={now} titulo="Cita reservada" />
              </>
            )}
            <div className="actions">
              {(hecho || pac?.activa?.cita) && <button type="button" className="btn sec" onClick={() => window.print()}><Printer /> Imprimir</button>}
              <button type="button" className="btn ghost" onClick={reiniciar}>{telefono ? 'Otra cita' : 'Salir'}</button>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Página pública «Sacar cita» (#/cita): no requiere sesión. */
export default function CitaWeb() {
  return (
    <div className="cw-page">
      <header className="cw-top">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Centro de Salud</span></div>
        </div>
        <a className="cw-link" href="#/"><LogIn aria-hidden="true" /> Personal del centro</a>
      </header>
      <main className="cw-main">
        <section className="cw-hero">
          <Icon3D name="calendar" size={72} />
          <div>
            <h1>Saque su cita</h1>
            <p>Elija la especialidad, el día y la hora según el horario de los médicos. Puede tener una cita a la vez.</p>
          </div>
        </section>
        <ReservaCita />
      </main>
    </div>
  );
}
