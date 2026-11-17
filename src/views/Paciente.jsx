import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ArrowLeft, CalendarCheck, CalendarPlus, FileText, KeyRound, LogIn, LogOut, MessageSquareText, Printer, Search, ShieldCheck } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { CENTRO, ESPECIALIDADES, MIN, STATE } from '../lib/constants.js';
import { PORTAL_INACTIVO_MIN } from '../lib/portal.js';
import { calcIMC } from '../lib/clinical.js';
import { age, fmtCitaDia, fmtD, fmtHora, fmtLongDay, isoDay } from '../lib/format.js';
import { listItem } from '../lib/motion.js';
import { useNow } from '../hooks/useNow.js';
import { useVerMas } from '../hooks/useVerMas.jsx';
import { Badge, Empty, Field, Msg, SisBadge, Tabs } from '../components/ui.jsx';
import { Acordeon, Grupo } from '../components/Acordeon.jsx';
import { Modal } from '../components/Modal.jsx';
import { Icono } from '../components/Icono.jsx';
import { BrandMark } from '../components/BrandMark.jsx';
import '../styles/vistas/citaweb.css';
import '../styles/vistas/paciente.css';
import '../styles/componentes/documentos.css';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const espNombre = (k) => ESPECIALIDADES.find((e) => e.k === k)?.n ?? 'Consulta';
const PASOS = ['Identifíquese', 'Código', 'Mi atención'];
/** Qué significa cada estado del turno para el paciente (sin jerga del personal). */
const QUE_HACER = {
  PENDIENTE_PAGO: 'Pase por Caja para pagar su consulta.',
  EN_ESPERA_TRIAJE: 'Espere en la sala: lo llamarán a triaje por la pantalla.',
  LLAMADO_TRIAJE: 'Lo están llamando: acérquese al módulo de triaje.',
  EN_TRIAJE: 'Está en triaje.',
  PENDIENTE_CITA: 'Ya pasó por triaje: en un momento le darán su cita.',
  EN_ESPERA_CONSULTA: 'Espere en la sala: su médico lo llamará por la pantalla.',
  LLAMADO_CONSULTA: 'Lo están llamando: pase a su consultorio.',
  EN_CONSULTA: 'Está en consulta.',
};

/** Receta de una atención, lista para imprimir (la misma que el paciente recibe al salir de la consulta). */
function Receta({ a, pac, onClose }) {
  return (
    <Modal label="Receta" onClose={onClose} className="doc">
      <header className="doc-h">
        <BrandMark />
        <div><small>{CENTRO.nombre}</small><h3>Prescripción farmacológica</h3></div>
        <b className="tcode doc-code">{a.rec}</b>
      </header>
      <dl className="doc-meta">
        <div><dt>Paciente</dt><dd>{pac.nom} {pac.ape}</dd></div>
        <div><dt>DNI</dt><dd>{pac.dni}</dd></div>
        <div><dt>Historia</dt><dd>{pac.hc}</dd></div>
        <div><dt>Edad</dt><dd>{age(pac.nac)} años</dd></div>
        <div><dt>Fecha</dt><dd>{fmtD(a.t)} {fmtHora(a.t)}</dd></div>
      </dl>
      {pac.alg && <Msg tone="crit"><b>Alergias:</b> {pac.alg}</Msg>}
      <div className="doc-sec">
        <h4>Diagnóstico</h4>
        <ul className="plain">{a.dx.map((d) => <li key={d[0]}><b className="code">{d[0]}</b> {d[1]}</li>)}</ul>
      </div>
      <TablaMeds meds={a.meds} />
      <dl className="doc-meta">
        <div><dt>Indicación</dt><dd>{a.dest}</dd></div>
        <div><dt>Profesional</dt><dd>{a.medico}{a.col ? `, ${a.col}` : ''}</dd></div>
        <div><dt>Consultorio</dt><dd>{a.area}</dd></div>
      </dl>
      <div className="actions end no-print">
        <button className="btn sec" onClick={() => window.print()}><Printer /> Imprimir</button>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

const TablaMeds = ({ meds }) => (
  <div className="tblw">
    <table className="tbl">
      <thead><tr><th>Medicamento</th><th>Dosis y frecuencia</th><th>Duración</th></tr></thead>
      <tbody>
        {meds.length ? meds.map((x, i) => (
          <tr key={i}><td>{x.n}</td><td>{[x.dosis, x.frec].filter(Boolean).join(', ')}</td><td>{x.dias ? `${x.dias} días` : ''}</td></tr>
        )) : <tr><td colSpan="3">Sin medicamentos indicados</td></tr>}
      </tbody>
    </table>
  </div>
);

/** Su turno de hoy (si está en el centro) y su próxima cita. */
function Proxima({ activa, now }) {
  const c = activa?.cita;
  const enCentro = activa && activa.state !== 'CITADO';
  return (
    <div className="pp-hoy">
      {enCentro && (
        <section className="pp-turno" aria-label="Su turno de hoy">
          <span className="rotulo">Su turno de hoy</span>
          <b className="tcode">{activa.id}</b>
          <Badge tone={STATE[activa.state]?.[1] ?? 'info'}>{STATE[activa.state]?.[0] ?? activa.state}</Badge>
          <p>{QUE_HACER[activa.state]}{activa.dest && activa.state.startsWith('LLAMADO') ? ` Destino: ${activa.dest}.` : ''}</p>
        </section>
      )}
      {c ? (
        <section className="pp-cita" style={{ '--e': `var(--esp-${c.esp})` }} aria-label="Su próxima cita">
          <div className="pp-cita-h">
            <CalendarCheck aria-hidden="true" />
            <span><small>{enCentro ? 'Su cita de hoy' : 'Su próxima cita'}</small><b>{cap(fmtCitaDia(c.at, now))}</b></span>
          </div>
          <div className="pp-cita-b">
            <div className="pp-hora"><b>{fmtHora(c.at)}</b><span>{cap(fmtLongDay(c.at))}</span></div>
            <dl>
              <div><dt>Especialidad</dt><dd>{espNombre(c.esp)}</dd></div>
              <div><dt>Profesional</dt><dd>{c.medico}</dd></div>
              <div><dt>Consultorio</dt><dd>{c.area}</dd></div>
            </dl>
          </div>
          {!enCentro && <p className="pp-nota">Ese día preséntese en Admisión con su DNI 15 minutos antes. Para cambiarla o anularla, llame o acérquese a Admisión.</p>}
        </section>
      ) : !enCentro && (
        <section className="pp-sin">
          <Empty icon="calendar" title="No tiene una cita pendiente">Puede reservar una ahora mismo, según el horario de los médicos.</Empty>
          <a className="btn" href="#/cita"><CalendarPlus /> Sacar cita</a>
        </section>
      )}
    </div>
  );
}

/** Sus atenciones, una por renglón plegable: cerrada resume fecha, especialidad y profesional. */
function Atenciones({ lista, onReceta }) {
  const [visibles, verMas] = useVerMas(lista, 6);
  if (!lista.length) return <Empty icon="folder" title="Todavía no tiene atenciones registradas" />;
  return (
    <>
      <Acordeon rotulo={`${lista.length} ${lista.length === 1 ? 'atención' : 'atenciones'}, de la más reciente a la más antigua`} barra={lista.length > 1}>
        {visibles.map((a, i) => (
          <Grupo
            key={a.id}
            titulo={cap(fmtLongDay(a.t))}
            sub={`${espNombre(a.esp)} · ${a.medico}`}
            color={a.esp ? `var(--esp-${a.esp})` : undefined}
            abierto={i === 0}
            extra={<Badge tone={a.dest === 'Alta' ? 'ok' : 'warn'}>{a.dest}</Badge>}
          >
            <div className="pp-at">
              <dl className="doc-meta">
                <div><dt>Profesional</dt><dd>{a.medico}</dd></div>
                <div><dt>Especialidad</dt><dd>{espNombre(a.esp)}</dd></div>
                <div><dt>Consultorio</dt><dd>{a.area || '—'}</dd></div>
                <div><dt>Hora</dt><dd>{fmtHora(a.t)}</dd></div>
              </dl>
              <div className="doc-sec">
                <h4>Diagnóstico</h4>
                <ul className="pp-dx">{a.dx.map((d) => <li key={d[0]}><b className="code">{d[0]}</b> {d[1]}</li>)}</ul>
              </div>
              {a.tri && (
                <div className="doc-sec">
                  <h4>Sus signos ese día</h4>
                  <ul className="pp-signos">
                    <li><span>Presión</span><b>{a.tri.pa}</b></li>
                    <li><span>Pulso</span><b>{a.tri.fc} lpm</b></li>
                    <li><span>Temperatura</span><b>{a.tri.t} °C</b></li>
                    <li><span>Oxígeno</span><b>{a.tri.spo2} %</b></li>
                    <li><span>Peso</span><b>{a.tri.peso} kg</b></li>
                    {a.tri.peso > 0 && a.tri.talla > 0 && <li><span>IMC</span><b>{calcIMC(a.tri.peso, a.tri.talla)}</b></li>}
                  </ul>
                </div>
              )}
              <div className="doc-sec">
                <h4>Receta {a.rec && <span className="code">{a.rec}</span>}</h4>
                <TablaMeds meds={a.meds} />
              </div>
              {a.rec && <div className="actions"><button type="button" className="btn sec sm" onClick={() => onReceta(a)}><FileText /> Ver receta para imprimir</button></div>}
            </div>
          </Grupo>
        ))}
      </Acordeon>
      {verMas}
    </>
  );
}

/** Sus recetas en una tabla: para encontrar una sin abrir cada atención. */
function Recetas({ lista, onReceta }) {
  const [visibles, verMas] = useVerMas(lista, 8);
  if (!lista.length) return <Empty icon="pill" title="Todavía no tiene recetas" />;
  return (
    <>
      <div className="tblw">
        <table className="tbl">
          <thead><tr><th>Receta</th><th>Fecha</th><th>Profesional</th><th>Medicamentos</th><th /></tr></thead>
          <tbody>
            {visibles.map((a) => (
              <tr key={a.rec}>
                <td className="code nowrap">{a.rec}</td>
                <td className="nowrap">{fmtD(a.t)}</td>
                <td>{a.medico}<small className="block">{espNombre(a.esp)}</small></td>
                <td className="wrap">{a.meds.map((x) => x.n).join(', ') || 'Sin medicamentos'}</td>
                <td><div className="row-acts"><button type="button" className="btn sec sm" onClick={() => onReceta(a)}><FileText /> Ver</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verMas}
    </>
  );
}

/** El portal ya abierto. Se cierra solo tras unos minutos sin actividad. */
function Portal({ datos, onSalir }) {
  const now = useNow(60_000);
  const [tab, setTab] = useState('at');
  const [receta, setReceta] = useState(null);
  const { pac, activa, atenciones, recetas } = datos;
  const ultima = atenciones[0];

  // Cierre por inactividad: el portal puede quedar abierto en un equipo compartido
  const cierre = useRef(null);
  const tocar = useCallback(() => {
    clearTimeout(cierre.current);
    cierre.current = setTimeout(() => onSalir('Cerramos su sesión por inactividad. Vuelva a identificarse para continuar.'), PORTAL_INACTIVO_MIN * MIN);
  }, [onSalir]);
  useEffect(() => {
    tocar();
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => window.addEventListener(e, tocar, { passive: true }));
    return () => {
      clearTimeout(cierre.current);
      evs.forEach((e) => window.removeEventListener(e, tocar));
    };
  }, [tocar]);

  return (
    <m.div {...listItem} className="stack">
      <section className="pp-carnet">
        <span className="pp-av" aria-hidden="true">{pac.nom[0]}{pac.ape[0]}</span>
        <div className="pp-quien">
          <small>Mi atención</small>
          <h1>Hola, {pac.nom.split(' ')[0]}</h1>
          <p><span className="code">{pac.hc}</span> · DNI <span className="code">{pac.dni}</span> · {age(pac.nac)} años</p>
        </div>
        <div className="pp-carnet-x">
          <SisBadge sis={pac.sis} />
          <button type="button" className="btn sec sm" onClick={() => onSalir()}><LogOut /> Salir</button>
        </div>
      </section>
      {pac.alg && <Msg tone="crit"><b>Alergia registrada:</b> {pac.alg}. Recuérdela siempre al personal de salud.</Msg>}

      <div className="figs pp-figs">
        <div className="fig"><span>Atenciones</span><b>{atenciones.length}</b></div>
        <div className="fig"><span>Última atención</span><b>{ultima ? fmtD(ultima.t) : '—'}</b></div>
        <div className="fig"><span>Recetas</span><b>{recetas.length}</b></div>
        <div className="fig"><span>Próxima cita</span><b>{activa?.cita ? fmtD(activa.cita.at) : '—'}</b></div>
      </div>

      <Proxima activa={activa} now={now} />

      <section className="panel">
        <Tabs label="Mi historial" value={tab} onChange={setTab} items={[['at', `Mis atenciones (${atenciones.length})`], ['rec', `Mis recetas (${recetas.length})`]]} />
        {tab === 'at' ? <Atenciones lista={atenciones} onReceta={setReceta} /> : <Recetas lista={recetas} onReceta={setReceta} />}
      </section>
      <p className="note pp-priv"><ShieldCheck aria-hidden="true" /> Solo usted ve esta página. Cada ingreso queda registrado y la sesión se cierra sola tras {PORTAL_INACTIVO_MIN} minutos sin uso.</p>

      <AnimatePresence>{receta && <Receta key={receta.rec} a={receta} pac={pac} onClose={() => setReceta(null)} />}</AnimatePresence>
    </m.div>
  );
}

/**
 * Página pública «Mi atención» (#/paciente): el paciente ve su cita, sus atenciones y sus recetas.
 * Entra en dos pasos: DNI y fecha de nacimiento, y luego un código de un solo uso enviado a su celular.
 * Los datos viven solo en la memoria de esta página: al salir o recargar hay que identificarse otra vez.
 */
export default function Paciente() {
  const { repo } = useStore();
  const now = useNow(60_000);
  const [paso, setPaso] = useState(0);
  const [dni, setDni] = useState('');
  const [nac, setNac] = useState('');
  const [envio, setEnvio] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [datos, setDatos] = useState(null);
  const [err, setErr] = useState('');
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false);

  const tarea = async (fn) => {
    setErr('');
    setAviso('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
      setCodigo(''); // un código fallido se borra para escribir el siguiente sin tener que limpiar el campo
      if (e.agotado) {
        setEnvio(null);
        setPaso(0);
      }
    } finally {
      setBusy(false);
    }
  };
  const pedirCodigo = (e) => {
    e?.preventDefault();
    tarea(async () => {
      setEnvio(await repo.portalCodigo(dni, nac));
      setCodigo('');
      setPaso(1);
    });
  };
  const entrar = (e) => {
    e.preventDefault();
    tarea(async () => {
      setDatos(await repo.portalEntrar(dni, codigo));
      setPaso(2);
    });
  };
  const salir = useCallback((motivo = '') => {
    setDatos(null); setEnvio(null); setCodigo(''); setDni(''); setNac(''); setErr(''); setPaso(0);
    setAviso(motivo);
  }, []);

  return (
    <div className="cw-page pp-page">
      <header className="cw-top">
        <div className="brand">
          <BrandMark />
          <div><b>SGC</b><span>Centro de Salud</span></div>
        </div>
        <nav className="cw-links" aria-label="Otras páginas">
          <a className="cw-link" href="#/cita"><CalendarPlus aria-hidden="true" /> Sacar cita</a>
          <a className="cw-link" href="#/"><LogIn aria-hidden="true" /> Personal del centro</a>
        </nav>
      </header>
      <main className={`cw-main ${paso === 2 ? 'pp-ancho' : ''}`}>
        {paso < 2 && (
          <section className="cw-hero">
            <Icono name="folder" size={72} />
            <div>
              <h1>Mi atención</h1>
              <p>Consulte su próxima cita, los días en que se atendió, con qué profesional y sus recetas.</p>
            </div>
          </section>
        )}
        {paso < 2 && (
          <div className="cw-box">
            <ol className="cw-steps pp-steps" aria-label="Pasos para entrar">
              {PASOS.map((n, i) => (
                <li key={n} className={i < paso ? 'done' : i === paso ? 'cur' : ''} aria-current={i === paso ? 'step' : undefined}>
                  <b>{i + 1}</b><span>{n}</span>
                </li>
              ))}
            </ol>
            {aviso && <Msg tone="info">{aviso}</Msg>}
            {err && <Msg tone="crit">{err}</Msg>}
            <AnimatePresence mode="wait">
              {paso === 0 ? (
                <m.form key="id" {...listItem} onSubmit={pedirCodigo} className="stack" noValidate>
                  <p className="cw-lead">Ingrese su DNI y su fecha de nacimiento. Le enviaremos un código a su celular registrado para confirmar que es usted.</p>
                  <div className="row">
                    <Field label="DNI">
                      {(a) => <input {...a} value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="8 dígitos" autoComplete="off" autoFocus />}
                    </Field>
                    <Field label="Fecha de nacimiento">
                      {(a) => <input {...a} type="date" value={nac} onChange={(e) => setNac(e.target.value)} max={isoDay(now)} />}
                    </Field>
                  </div>
                  <button className="btn lg" disabled={busy || dni.length !== 8 || !nac}><Search /> {busy ? 'Buscando…' : 'Enviar código'}</button>
                </m.form>
              ) : (
                <m.form key="cod" {...listItem} onSubmit={entrar} className="stack" noValidate>
                  <p className="cw-lead">Enviamos un código de 6 dígitos al celular <b className="code">{envio.tel}</b>. Vale por {envio.min} minutos y sirve una sola vez.</p>
                  {envio.demo && (
                    <div className="pp-sms" role="status">
                      <MessageSquareText aria-hidden="true" />
                      <div>
                        <small>Mensaje simulado (prototipo sin proveedor de SMS)</small>
                        <p>SGC Centro de Salud: su código es <b className="code">{envio.demo}</b>. No lo comparta con nadie.</p>
                      </div>
                    </div>
                  )}
                  <Field label="Código">
                    {(a) => <input {...a} className="pp-cod" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" autoComplete="one-time-code" autoFocus />}
                  </Field>
                  <div className="actions">
                    <button className="btn lg" disabled={busy || codigo.length !== 6}><KeyRound /> {busy ? 'Verificando…' : 'Entrar'}</button>
                    <button type="button" className="btn ghost" onClick={() => pedirCodigo()} disabled={busy}>Enviar otro código</button>
                    <button type="button" className="btn ghost" onClick={() => salir()}><ArrowLeft /> Cambiar DNI</button>
                  </div>
                </m.form>
              )}
            </AnimatePresence>
          </div>
        )}
        {paso === 2 && datos && <Portal datos={datos} onSalir={salir} />}
      </main>
    </div>
  );
}
