import { useMemo } from 'react';
import { ACTIVE_STATES, DAY, PRIO } from '../../lib/constants.js';
import { HORAS_AFLUENCIA } from '../../lib/analytics.js';
import { modeloAfluencia, modeloEspera } from '../../lib/ml.js';
import { fmtLongDay, fmtNum, fmtT, startOfDay } from '../../lib/format.js';
import { BarList } from '../../components/charts/BarList.jsx';
import { Msg, Panel, PrioBadge, TurnCode } from '../../components/ui.jsx';

const num1 = (x) => x.toLocaleString('es-PE', { maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)} %`;
const PRIO_COLOR = { CRITICA: 'var(--crit)', PRIORITARIA: 'var(--warn)', NORMAL: 'var(--good)' };
const dia = (t, now) => {
  if (t === startOfDay(now)) return 'Hoy';
  if (t === startOfDay(startOfDay(now) + DAY + DAY / 2)) return 'Mañana';
  const d = fmtLongDay(t);
  return d.charAt(0).toUpperCase() + d.slice(1);
};

/** Error del modelo frente a la línea base: cuánto mejora (o empeora) el error medio. */
function Comparacion({ m, unidad, base }) {
  const mejora = m.maeBase ? 1 - m.mae / m.maeBase : 0;
  return (
    <div className="ml-kpis">
      <div className="ml-kpi"><small>Error medio del modelo (MAE)</small><b>{num1(m.mae)} {unidad}</b></div>
      <div className="ml-kpi"><small>Error de la línea base ({base})</small><b>{num1(m.maeBase)} {unidad}</b></div>
      <div className={`ml-kpi ${mejora > 0.02 ? 'good' : ''}`}><small>{mejora >= 0 ? 'Mejora del modelo' : 'El modelo empeora'}</small><b>{pct(Math.abs(mejora))}</b></div>
      <div className="ml-kpi"><small>Datos de entrenamiento / de prueba</small><b>{fmtNum(m.n.train)} / {fmtNum(m.n.test)}</b></div>
    </div>
  );
}

/** Espera predicha frente a la real en la semana de prueba: cuanto más cerca de la diagonal, mejor. */
function Dispersion({ puntos }) {
  const max = Math.max(10, ...puntos.flatMap((p) => [p.real, p.pred]));
  const W = 260;
  const s = (v) => (v / max) * W;
  return (
    <svg className="ml-scatter" viewBox={`-30 -10 ${W + 40} ${W + 40}`} role="img" aria-label="Espera predicha frente a la real en la semana de prueba">
      <line x1="0" y1={W} x2={W} y2="0" className="diag" />
      <line x1="0" y1={W} x2={W} y2={W} className="eje" />
      <line x1="0" y1="0" x2="0" y2={W} className="eje" />
      {puntos.map((p, i) => <circle key={i} cx={s(p.real)} cy={W - s(p.pred)} r="3" fill={PRIO_COLOR[p.prio]} opacity="0.75" />)}
      <text x={W / 2} y={W + 22} textAnchor="middle">Espera real (min)</text>
      <text x={-W / 2} y="-18" transform="rotate(-90)" textAnchor="middle">Espera predicha (min)</text>
      <text x="2" y={W + 12}>0</text>
      <text x={W - 14} y={W + 12}>{Math.round(max)}</text>
    </svg>
  );
}

/**
 * Predicción con aprendizaje automático: dos casos de uso entrenados en el navegador con los hechos anónimos de
 * las últimas semanas, evaluados en la última semana y aplicados a los pacientes y los días que vienen.
 */
export function PrediccionML({ facts, turns, now, error }) {
  const espera = useMemo(() => (facts ? modeloEspera(facts, now) : null), [facts, now]);
  const afluencia = useMemo(() => (facts ? modeloAfluencia(facts, now) : null), [facts, now]);
  if (error) return <Msg tone="crit">No se pudo entrenar el modelo: {error}</Msg>;
  if (!facts) return <div className="skeleton" style={{ height: 160 }} />;
  if (!espera && !afluencia) return <Msg tone="info">Aún no hay semanas suficientes para entrenar el modelo.</Msg>;

  // Caso 1 aplicado: pacientes que están hoy en el centro y aún no pasan a consulta
  const hoy = startOfDay(now);
  const cargaHoy = turns.filter((t) => t.t0 >= hoy).reduce((m, t) => m.set(new Date(t.t0).getHours(), (m.get(new Date(t.t0).getHours()) || 0) + 1), new Map());
  const enEspera = turns
    .filter((t) => ACTIVE_STATES.includes(t.state) && t.state !== 'CITADO' && !['LLAMADO_CONSULTA', 'EN_CONSULTA'].includes(t.state) && t.t0 >= hoy)
    .map((t) => {
      const paga = t.pago ? t.pago.metodo !== 'SIS' : t.state === 'PENDIENTE_PAGO';
      const est = espera?.predecir({ prio: t.prio, paga, t0: t.t0 }, cargaHoy.get(new Date(t.t0).getHours()) || 1);
      return { t, paga, est, lleva: Math.max(0, Math.round((now - t.t0) / 60_000)) };
    })
    .sort((a, b) => a.t.t0 - b.t.t0);
  const maxAfl = afluencia ? Math.max(1, ...afluencia.proximos.flatMap((d) => [...d.ml, ...d.base])) : 1;

  return (
    <div className="dash-grid">
      <div className="span-3"><Msg tone="info">
        <b>Modelo: bosque aleatorio</b> de 40 árboles de regresión, entrenado en este navegador con los turnos anónimos de las
        últimas semanas. Se evalúa con la última semana, que el modelo no vio durante el entrenamiento, y se compara con la regla que el
        sistema usaba antes (línea base). Con datos ficticios, las cifras muestran cómo funciona el método, no la precisión que tendría con datos reales.
      </Msg></div>

      {espera && (
        <Panel title="Caso 1 · Espera del paciente hasta la consulta (RF-14)" sub="Minutos desde la llegada hasta el llamado del médico: pago, triaje y consulta" className="span-3">
          <Comparacion m={espera} unidad="min" base="promedio de su prioridad" />
          <div className="ml-row">
            <div>
              <h4 className="ml-h">Predicción frente a la realidad (semana de prueba)</h4>
              <Dispersion puntos={espera.puntos} />
              <p className="ml-leyenda">{Object.keys(PRIO_COLOR).map((k) => <span key={k}><i style={{ background: PRIO_COLOR[k] }} /> {PRIO[k][0]}</span>)}</p>
            </div>
            <div>
              <h4 className="ml-h">Qué pesa más en la espera</h4>
              <BarList rows={espera.importancia.map((x) => ({ k: x.n, label: x.n, value: x.v }))} color="var(--st-jef)" format={pct} />
              <h4 className="ml-h">Pacientes en el centro ahora</h4>
              {enEspera.length ? (
                <div className="tblw">
                  <table className="tbl">
                    <thead><tr><th>Turno</th><th>Llegó</th><th>Prioridad</th><th className="num">Lleva</th><th className="num">Espera total estimada</th></tr></thead>
                    <tbody>
                      {enEspera.map(({ t, est, lleva }) => (
                        <tr key={t.id}>
                          <td><TurnCode id={t.id} /></td>
                          <td>{fmtT(t.t0)}</td>
                          <td>{t.prio ? <PrioBadge prio={t.prio} /> : <span className="muted">Sin triaje</span>}</td>
                          <td className="num">{lleva} min</td>
                          <td className="num"><b>≈ {Math.round(est)} min</b>{lleva > est && <small className="muted"> · superada</small>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="prev-note">No hay pacientes esperando en este momento.</p>}
            </div>
          </div>
        </Panel>
      )}

      {afluencia && (
        <Panel title="Caso 2 · Afluencia por hora para los próximos días (RF-15)" sub="Llegadas previstas por el modelo, comparadas con el promedio de las últimas 4 semanas" className="span-3">
          <Comparacion m={afluencia} unidad="llegadas/h" base="promedio de 4 semanas" />
          <div className="ml-row">
            <div className="tblw">
              <table className="tbl prev">
                <thead><tr><th>Día</th><th className="num">Modelo</th><th className="num">Promedio</th><th>Por hora, de {HORAS_AFLUENCIA[0]} a {HORAS_AFLUENCIA.at(-1) + 1} h (modelo)</th></tr></thead>
                <tbody>
                  {afluencia.proximos.map((d) => (
                    <tr key={d.t}>
                      <td>{dia(d.t, now)}</td>
                      <td className="num">{fmtNum(Math.round(d.ml.reduce((a, b) => a + b, 0)))}</td>
                      <td className="num">{fmtNum(Math.round(d.base.reduce((a, b) => a + b, 0)))}</td>
                      <td>
                        <span className="hbars" role="img" aria-label={`Llegadas previstas: ${d.ml.map((x, i) => `${HORAS_AFLUENCIA[i]} h ${num1(x)}`).join(', ')}`}>
                          {d.ml.map((x, i) => <i key={i} className="peak" style={{ height: `${Math.max(4, (x / maxAfl) * 100)}%` }} title={`${HORAS_AFLUENCIA[i]} h: ${num1(x)}`} />)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="ml-h">Qué pesa más en la afluencia</h4>
              <BarList rows={afluencia.importancia.map((x) => ({ k: x.n, label: x.n, value: x.v }))} color="var(--st-jef)" format={pct} />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
