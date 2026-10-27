import { useStore } from '../store/useStore.js';
import { CENTRO, CONCEPTO_PAGO, DAY, IGV, METODOS_PAGO, SIS, VIGENCIA_RECETA_DIAS } from '../lib/constants.js';
import { age, ageAt, cap, enLetras, fmtD, fmtDT, fmtHora, fmtLongDay, fmtSoles, fmtT, fullName, maskDni, solesEnLetras } from '../lib/format.js';
import { especialidad } from '../lib/agenda.js';
import { useNow } from '../hooks/useNow.js';
import './print.css';

/*
 * Formatos de impresión, uno por tipo de documento. En pantalla no se ven: al imprimir reemplazan a la
 * ventana del documento, cada uno con su tamaño de papel.
 * - Ticket de turno, constancia de cita y boleta: papel térmico de 80 mm.
 * - Receta: A5, con los datos que exige el D. S. N.° 014-2011-SA (art. sobre el contenido de la receta) y el
 *   Manual de Buenas Prácticas de Prescripción del MINSA: establecimiento, prescriptor y colegiatura, paciente,
 *   diagnóstico, medicamento en DCI con concentración, forma farmacéutica, cantidad en números y letras,
 *   posología (dosis, vía, frecuencia y duración), fecha de emisión y de vencimiento, firma y sello.
 * - Historia clínica: A4, con la estructura de la NTS N.° 139-MINSA/2018/DGAIN (identificación del
 *   establecimiento y del paciente en cada hoja, atenciones en orden cronológico con fecha, hora, funciones
 *   vitales, diagnóstico CIE-10, tratamiento y firma del profesional, y hojas numeradas).
 * - Boleta: representación impresa con los datos del Reglamento de Comprobantes de Pago (SUNAT): emisor y RUC,
 *   serie y correlativo, fecha, adquirente, detalle, IGV, total y el importe en letras.
 * Todos los datos del establecimiento son ficticios y cada formato lo declara.
 */

const DEMO = 'Documento de demostración: datos ficticios, sin validez legal.';

/** Encabezado institucional de los formatos A4 y A5. */
function Membrete({ titulo, numero, children }) {
  return (
    <header className="ps-mem">
      <div className="ps-mem-ent">
        <b>{CENTRO.nombre}</b>
        <span>Categoría {CENTRO.categoria} · RENIPRESS {CENTRO.renipress}</span>
        <span>{CENTRO.direccion} · Telf. {CENTRO.telefono}</span>
      </div>
      <div className="ps-mem-doc">
        <b>{titulo}</b>
        {numero && <span className="ps-num">N.° {numero}</span>}
        {children}
      </div>
    </header>
  );
}

/** Encabezado de los formatos de papel térmico. */
const MembreteTermico = ({ ruc = false }) => (
  <header className="ps-tmem">
    <b>{CENTRO.nombre}</b>
    {ruc && <span>{CENTRO.razon}</span>}
    {ruc && <span>RUC {CENTRO.ruc}</span>}
    <span>{CENTRO.direccion}</span>
    <span>Telf. {CENTRO.telefono}</span>
  </header>
);

const Campo = ({ k, children, wide }) => (
  <div className={`ps-f ${wide ? 'wide' : ''}`}><dt>{k}</dt><dd>{children || '—'}</dd></div>
);

/* ---------- Ticket de turno (80 mm) ---------- */

const RUTA = [['Caja', 'PENDIENTE_PAGO'], ['Triaje', 'TRIAJE'], ['Cita', 'CITA'], ['Consulta', 'CONSULTA']];
const PASO = {
  PENDIENTE_PAGO: 0, EN_ESPERA_TRIAJE: 1, LLAMADO_TRIAJE: 1, EN_TRIAJE: 1, PENDIENTE_CITA: 2, CITADO: 2,
  EN_ESPERA_CONSULTA: 3, LLAMADO_CONSULTA: 3, EN_CONSULTA: 3, ATENDIDO: 4,
};

export function TicketPrint({ turn: t, indicacion, espera }) {
  const { patient } = useStore();
  const p = patient(t.dni);
  const paso = PASO[t.state] ?? 0;
  const sis = t.pago?.metodo === 'SIS';
  return (
    <section className="ps ps-termica" aria-hidden="true">
      <MembreteTermico />
      <p className="ps-ttl">Ticket de atención</p>
      <p className="ps-big">{t.id}</p>
      <p className="ps-c">Emitido el {fmtD(t.t0)} a las {fmtT(t.t0)}</p>
      <ol className="ps-ruta">
        {RUTA.map(([n], i) => (
          <li key={n} className={i < paso ? 'ok' : i === paso ? 'cur' : ''}>
            <span aria-hidden="true">{i < paso ? '✓' : i === paso ? '►' : '○'}</span> {n}
            {n === 'Caja' && sis && ' (exonerado SIS)'}
          </li>
        ))}
      </ol>
      <p className="ps-box">{indicacion}</p>
      {espera && <p className="ps-c">Espera aproximada: <b>{espera}</b></p>}
      <hr className="ps-cut" />
      <dl className="ps-kv">
        <Campo k="DNI">{p ? maskDni(p.dni) : ''}</Campo>
        <Campo k="Historia clínica">{p?.hc}</Campo>
      </dl>
      <p className="ps-foot">Conserve este ticket: su código aparecerá en la pantalla de la sala. Los casos más graves se atienden primero.</p>
      <p className="ps-foot">Sus datos personales están protegidos (Ley N.° 29733).</p>
      <p className="ps-demo">{DEMO}</p>
    </section>
  );
}

/* ---------- Constancia de cita (80 mm) ---------- */

export function CitaPrint({ turn: t }) {
  const { patient, db } = useStore();
  const p = patient(t.dni);
  const c = t.cita;
  const med = db.users.find((x) => x.u === c.med);
  const autor = db.users.find((x) => x.u === c.by);
  return (
    <section className="ps ps-termica" aria-hidden="true">
      <MembreteTermico />
      <p className="ps-ttl">Constancia de cita</p>
      <p className="ps-c ps-day">{cap(fmtLongDay(c.at))} de {new Date(c.at).getFullYear()}</p>
      <p className="ps-big">{fmtHora(c.at)}</p>
      <dl className="ps-kv">
        <Campo k="Especialidad" wide>{especialidad(c.esp)?.n}</Campo>
        <Campo k="Médico" wide>{med?.n ?? c.med}{med?.col ? ` · ${med.col}` : ''}</Campo>
        <Campo k="Consultorio">{c.area}</Campo>
        <Campo k="Turno">{t.id}</Campo>
        <Campo k="Paciente" wide>{p ? `${p.nom} ${p.ape}` : ''}</Campo>
        <Campo k="DNI">{p ? maskDni(p.dni) : ''}</Campo>
        <Campo k="Historia clínica">{p?.hc}</Campo>
      </dl>
      {c.sobre && <p className="ps-box">Sobrecupo por prioridad crítica: será atendido lo antes posible.</p>}
      <ul className="ps-list">
        <li>Preséntese en Admisión con su DNI 15 minutos antes de su hora.</li>
        <li>No necesita volver a pagar ni pasar por triaje.</li>
        <li>Si no puede asistir, reprograme su cita por la web o por teléfono.</li>
      </ul>
      <p className="ps-foot">Emitida el {fmtDT(c.t ?? t.tCita ?? t.t0)}{autor ? ` por ${autor.n}` : ''}.</p>
      <p className="ps-demo">{DEMO}</p>
    </section>
  );
}

/* ---------- Boleta de venta (80 mm) ---------- */

export function BoletaPrint({ turn: t }) {
  const { patient, db } = useStore();
  const p = patient(t.dni);
  const g = t.pago;
  const cajero = db.users.find((x) => x.u === g.by)?.n ?? g.by;

  // Con SIS no se emite boleta: se imprime la constancia de exoneración
  if (!g.comp) {
    return (
      <section className="ps ps-termica" aria-hidden="true">
        <MembreteTermico />
        <p className="ps-ttl">Constancia de exoneración</p>
        <p className="ps-c">Atención cubierta por el Seguro Integral de Salud (SIS)</p>
        <dl className="ps-kv">
          <Campo k="Paciente" wide>{fullName(p)}</Campo>
          <Campo k="DNI">{p?.dni}</Campo>
          <Campo k="Seguro">{SIS[p?.sis]?.[0]}</Campo>
          <Campo k="Turno">{t.id}</Campo>
          <Campo k="Fecha">{fmtDT(g.t)}</Campo>
          <Campo k="Concepto" wide>{CONCEPTO_PAGO}</Campo>
          <Campo k="Importe">{fmtSoles(0)}</Campo>
          <Campo k="Registrado por" wide>{cajero}</Campo>
        </dl>
        <p className="ps-foot">No es comprobante de pago: el asegurado no paga la consulta.</p>
        <p className="ps-demo">{DEMO}</p>
      </section>
    );
  }

  const total = g.monto;
  const gravada = Math.round((total / (1 + IGV)) * 100) / 100;
  const igv = Math.round((total - gravada) * 100) / 100;
  return (
    <section className="ps ps-termica" aria-hidden="true">
      <MembreteTermico ruc />
      <div className="ps-comp">
        <b>Boleta de venta electrónica</b>
        <b>{g.comp}</b>
      </div>
      <dl className="ps-kv">
        <Campo k="Fecha de emisión">{fmtD(g.t)}</Campo>
        <Campo k="Hora">{fmtT(g.t)}</Campo>
        <Campo k="Moneda">Soles (PEN)</Campo>
        <Campo k="Forma de pago">Contado</Campo>
        <Campo k="Cliente" wide>{fullName(p)}</Campo>
        <Campo k="DNI">{p?.dni}</Campo>
        <Campo k="Turno">{t.id}</Campo>
      </dl>
      <table className="ps-tbl">
        <thead><tr><th>Cant.</th><th>U. M.</th><th>Descripción</th><th className="n">P. unit.</th><th className="n">Importe</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>ZZ</td><td>{CONCEPTO_PAGO}</td><td className="n">{total.toFixed(2)}</td><td className="n">{total.toFixed(2)}</td></tr>
        </tbody>
      </table>
      <dl className="ps-tot">
        <div><dt>Op. gravada</dt><dd>{fmtSoles(gravada)}</dd></div>
        <div><dt>IGV ({Math.round(IGV * 100)} %)</dt><dd>{fmtSoles(igv)}</dd></div>
        <div className="big"><dt>Importe total</dt><dd>{fmtSoles(total)}</dd></div>
      </dl>
      <p className="ps-letras">{solesEnLetras(total)}</p>
      <dl className="ps-kv">
        <Campo k="Medio de pago">{METODOS_PAGO[g.metodo]}</Campo>
        <Campo k="Cajero(a)">{cajero}</Campo>
      </dl>
      <p className="ps-foot">Representación impresa de la boleta de venta electrónica. U. M. ZZ: servicio.</p>
      <p className="ps-demo">Demostración: RUC ficticio, no enviada a SUNAT y sin valor tributario.</p>
    </section>
  );
}

/* ---------- Receta (A5) ---------- */

/** Separa «Paracetamol 500 mg» en DCI y concentración, e infiere la forma farmacéutica y la vía. */
function presentacion(m) {
  const conc = m.n.match(/\s(\d[\d.,]*\s*(?:mg|g|mcg|µg|ml|UI|%)(?:\s*\/\s*\d*\s*\w+)?)\s*$/i);
  const inh = /inhalador/i.test(m.n) || /puff|inhal/i.test(m.dosis);
  const dci = (conc ? m.n.slice(0, conc.index) : m.n).replace(/\s*inhalador\s*/i, '').trim();
  const d = (m.dosis || '').toLowerCase();
  const forma = inh ? 'Aerosol para inhalación'
    : /c[áa]psula/.test(d) ? 'Cápsula'
      : /jarabe|suspensi|ml/.test(d) ? 'Suspensión oral'
        : /gota/.test(d) ? 'Gotas'
          : /crema|ung/.test(d) ? 'Crema'
            : /tableta|comprimido|tab/.test(d) ? 'Tableta' : 'Según presentación';
  const via = inh ? 'Inhalatoria' : /crema|ung/.test(d) ? 'Tópica' : 'Oral';
  return { dci, conc: conc?.[1] ?? '—', forma, via };
}

/** Cantidad total a dispensar: la indicada o, si falta, dosis × tomas por día × días. */
function cantidad(m, forma) {
  if (m.cant) return +m.cant || m.cant;
  if (forma === 'Aerosol para inhalación') return 1;
  const dosis = parseFloat(String(m.dosis).replace(',', '.'));
  const h = String(m.frec).match(/cada\s*(\d+)\s*h/i)?.[1];
  const veces = String(m.frec).match(/(\d+)\s*ve(?:z|ces)/i)?.[1];
  const porDia = h ? Math.max(1, Math.round(24 / +h)) : +(veces || 1);
  return dosis && m.dias ? Math.ceil(dosis * porDia * m.dias) : null;
}

/** Unidad de dispensación de cada forma: [singular, plural, femenina]. */
const UNIDADES = {
  Tableta: ['tableta', 'tabletas', true], Cápsula: ['cápsula', 'cápsulas', true], 'Aerosol para inhalación': ['inhalador', 'inhaladores'],
  'Suspensión oral': ['frasco', 'frascos'], Gotas: ['frasco', 'frascos'], Crema: ['tubo', 'tubos'],
};
/** «21 (veintiuna) tabletas»: la cantidad en números y letras, como pide la receta. */
const cantidadEnLetras = (forma, n) => {
  const [uno, varios, fem] = UNIDADES[forma] || ['unidad', 'unidades', true];
  const letras = enLetras(n).replace(/ún$/, fem ? 'una' : 'uno').replace(/\bun$/, fem ? 'una' : 'uno');
  return `${n} (${letras}) ${n === 1 ? uno : varios}`;
};

export function RecetaPrint({ turn: t, control }) {
  const { patient, db } = useStore();
  const p = patient(t.dni);
  const c = t.consult;
  const meds = c.meds.map((m) => {
    const pr = presentacion(m);
    return { ...m, ...pr, total: cantidad(m, pr.forma) };
  });
  const vence = c.t + VIGENCIA_RECETA_DIAS * DAY;
  const esp = especialidad(db.users.find((x) => x.u === c.medico?.u)?.esp)?.n;
  return (
    <section className="ps ps-a5" aria-hidden="true">
      <Membrete titulo="Receta médica" numero={c.rec}>
        <span>Emitida: {fmtDT(c.t)}</span>
        <span>Válida hasta: {fmtD(vence)}</span>
      </Membrete>

      <dl className="ps-grid">
        <Campo k="Paciente" wide>{fullName(p)}</Campo>
        <Campo k="DNI">{p?.dni}</Campo>
        <Campo k="Historia clínica">{p?.hc}</Campo>
        <Campo k="Edad">{p ? `${ageAt(p.nac, c.t)} años` : ''}</Campo>
        <Campo k="Sexo">{p?.sexo === 'F' ? 'Femenino' : 'Masculino'}</Campo>
        <Campo k="Peso">{t.tri?.peso ? `${t.tri.peso} kg` : ''}</Campo>
        <Campo k="Seguro">{SIS[p?.sis]?.[0]}</Campo>
        <Campo k="Alergias" wide>{p?.alg ? <b>{p.alg}</b> : 'Ninguna conocida'}</Campo>
      </dl>

      <h4 className="ps-h">Diagnóstico (CIE-10)</h4>
      <ul className="ps-dx">
        {c.dx.map((d) => <li key={d[0]}><b>{d[0]}</b> {d[1]} ({d[2] === 'D' ? 'definitivo' : 'presuntivo'})</li>)}
      </ul>

      <h4 className="ps-h">Rp.</h4>
      {meds.length ? (
        <table className="ps-tbl">
          <thead><tr><th>N.°</th><th>Medicamento (DCI)</th><th>Concentración</th><th>Forma farmacéutica</th><th>Cantidad</th></tr></thead>
          <tbody>
            {meds.map((m, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><b>{m.dci}</b></td>
                <td>{m.conc}</td>
                <td>{m.forma}</td>
                <td>{m.total != null ? cantidadEnLetras(m.forma, m.total) : 'Según indicación'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="ps-box">Sin medicamentos indicados.</p>}

      {meds.length > 0 && (
        <>
          <h4 className="ps-h">Indicaciones para el paciente</h4>
          <table className="ps-tbl">
            <thead><tr><th>N.°</th><th>Medicamento</th><th>Dosis</th><th>Vía</th><th>Frecuencia</th><th>Duración</th></tr></thead>
            <tbody>
              {meds.map((m, i) => (
                <tr key={i}><td>{i + 1}</td><td>{m.dci}</td><td>{m.dosis || '—'}</td><td>{m.via}</td><td>{m.frec || '—'}</td><td>{m.dias ? `${m.dias} días` : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <dl className="ps-grid">
        <Campo k="Destino" wide>{c.dest}{c.destx ? ` (${c.dest === 'Reposo médico' ? `${c.destx} días` : c.destx})` : ''}</Campo>
        {control && <Campo k="Próximo control" wide>{cap(fmtLongDay(control.cita.at))}, {fmtHora(control.cita.at)} · {control.cita.area}</Campo>}
      </dl>

      <div className="ps-firma">
        <div className="ps-firma-l" />
        <b>{c.medico?.n}</b>
        <span>{c.medico?.col}{esp ? ` · ${esp}` : ''} · {c.area}</span>
        <span>Firma y sello del médico</span>
      </div>
      <p className="ps-foot">Prescripción en Denominación Común Internacional (DCI) según el D. S. N.° 014-2011-SA y el Manual de Buenas Prácticas de Prescripción (MINSA). No se dispensa después de la fecha de vencimiento.</p>
      <p className="ps-demo">{DEMO} Colegiatura ficticia.</p>
    </section>
  );
}

/* ---------- Historia clínica (A4) ---------- */

const imc = (tri) => (tri?.peso && tri?.talla ? (tri.peso / tri.talla ** 2).toFixed(1) : null);

export function HistoriaPrint({ patient: p, visits }) {
  const { db, user } = useStore();
  const now = useNow(60_000);
  const enf = (u) => db.users.find((x) => x.u === u)?.n ?? u;
  const lista = visits.slice().sort((a, b) => a.t0 - b.t0);
  return (
    <section className="ps ps-a4" aria-hidden="true">
      <table className="ps-page">
        <thead>
          <tr><td>
            <Membrete titulo="Historia clínica" numero={p.hc}>
              <span>{fullName(p)} · DNI {p.dni}</span>
            </Membrete>
          </td></tr>
        </thead>
        <tfoot>
          <tr><td>
            <p className="ps-foot">
              Documento confidencial (Ley N.° 26842, art. 25, y Ley N.° 29733). Formato según la NTS N.° 139-MINSA/2018/DGAIN.
              Impreso el {fmtDT(now)} por {user?.n ?? '—'}. {DEMO}
            </p>
          </td></tr>
        </tfoot>
        <tbody>
          <tr><td>
            <h4 className="ps-h">I. Datos de filiación</h4>
            <dl className="ps-grid">
              <Campo k="Apellidos y nombres" wide>{p.ape}, {p.nom}</Campo>
              <Campo k="DNI">{p.dni}</Campo>
              <Campo k="N.° de historia">{p.hc}</Campo>
              <Campo k="Fecha de nacimiento">{fmtD(new Date(`${p.nac}T00:00:00`))}</Campo>
              <Campo k="Edad">{age(p.nac)} años</Campo>
              <Campo k="Sexo">{p.sexo === 'F' ? 'Femenino' : 'Masculino'}</Campo>
              <Campo k="Teléfono">{p.tel}</Campo>
              <Campo k="Seguro">{SIS[p.sis]?.[0]}</Campo>
            </dl>

            <h4 className="ps-h">II. Antecedentes</h4>
            <dl className="ps-grid">
              <Campo k="Personales patológicos" wide>{p.ant || 'Ninguno registrado'}</Campo>
              <Campo k="Alergias" wide>{p.alg ? <b>{p.alg}</b> : 'Ninguna conocida'}</Campo>
            </dl>

            <h4 className="ps-h">III. Atenciones ({lista.length})</h4>
            {!lista.length && <p className="ps-box">Sin atenciones registradas.</p>}
            {lista.map((t) => {
              const c = t.consult;
              const v = t.tri || {};
              return (
                <article className="ps-at" key={`${t.id}-${t.t0}`}>
                  <header>
                    <b>{fmtD(c.t)} · {fmtT(c.t)}</b>
                    <span>Turno {t.id} · {c.area}{t.prio ? ` · Prioridad de triaje: ${t.prio.toLowerCase()}` : ''}</span>
                  </header>
                  {t.tri && (
                    <table className="ps-tbl ps-vit">
                      <thead><tr><th>PA</th><th>FC</th><th>FR</th><th>T</th><th>SpO₂</th><th>Peso</th><th>Talla</th><th>IMC</th></tr></thead>
                      <tbody><tr>
                        <td>{v.pa ?? '—'} mmHg</td><td>{v.fc ?? '—'} lpm</td><td>{v.fr ?? '—'} rpm</td><td>{v.t ?? '—'} °C</td>
                        <td>{v.spo2 ?? '—'} %</td><td>{v.peso ? `${v.peso} kg` : '—'}</td><td>{v.talla ? `${v.talla} m` : '—'}</td><td>{imc(v) ?? '—'}</td>
                      </tr></tbody>
                    </table>
                  )}
                  <dl className="ps-grid">
                    <Campo k="Motivo de consulta" wide>{v.motivo}</Campo>
                    {c.notas && <Campo k="Evolución y examen" wide>{c.notas}</Campo>}
                    <Campo k="Diagnóstico (CIE-10)" wide>
                      {c.dx.map((d) => `${d[0]} ${d[1]} (${d[2] === 'D' ? 'definitivo' : 'presuntivo'})`).join('; ')}
                    </Campo>
                    <Campo k="Tratamiento" wide>
                      {c.meds.length ? c.meds.map((m) => [m.n, m.dosis, m.frec, m.dias && `${m.dias} días`].filter(Boolean).join(', ')).join('; ') : 'Sin medicación'}
                      {c.rec ? ` (receta ${c.rec})` : ''}
                    </Campo>
                    <Campo k="Destino" wide>{c.dest}{c.destx ? ` (${c.dest === 'Reposo médico' ? `${c.destx} días` : c.destx})` : ''}</Campo>
                  </dl>
                  <footer>
                    {t.enf && <span>Triaje: {enf(t.enf)}</span>}
                    <span className="ps-sello">{c.medico?.n} · {c.medico?.col} <i>Firma y sello</i></span>
                  </footer>
                </article>
              );
            })}
          </td></tr>
        </tbody>
      </table>
    </section>
  );
}
