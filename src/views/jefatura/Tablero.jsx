import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Download, Minus } from 'lucide-react';
import { useStore } from '../../store/useStore.js';
import { AREAS, DAY, PRIO, WAIT_TARGET } from '../../lib/constants.js';
import {
  RANGES, periodOf, slice, summarize, series, heatmap, topDx, destinos, perfil, cumplimiento, porConsultorio, delta, toCSV,
} from '../../lib/analytics.js';
import { DOW_NAMES, fmtDay, fmtLongDay, fmtMin, fmtNum, fmtPct, isoDay } from '../../lib/format.js';
import { downloadText } from '../../lib/download.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useNow } from '../../hooks/useNow.js';
import { WorkspaceHeader } from '../../components/WorkspaceHeader.jsx';
import { AnimatedNumber, Msg, Panel, Segmented } from '../../components/ui.jsx';
import { ColumnChart, LineChart } from '../../components/charts/BandChart.jsx';
import { Heatmap } from '../../components/charts/Heatmap.jsx';
import { BarList } from '../../components/charts/BarList.jsx';
import { StackBar } from '../../components/charts/StackBar.jsx';
import { Meter } from '../../components/charts/Meter.jsx';
import { Sparkline } from '../../components/charts/Sparkline.jsx';
import '../../components/charts/charts.css';
import './jefatura.css';

const PRIO_SERIES = [
  { k: 'NORMAL', label: 'Normal', color: 'var(--good)' },
  { k: 'PRIORITARIA', label: 'Prioritaria', color: 'var(--warn)' },
  { k: 'CRITICA', label: 'Crítica', color: 'var(--crit)' },
];
const DEST_COLOR = { Alta: 'var(--cat-1)', 'Reposo médico': 'var(--cat-2)', 'Derivación a hospital': 'var(--cat-3)' };
const minFmt = (v) => fmtNum(Math.round(v));

/** Cifra principal con variación frente al periodo anterior. `good` dice si subir es bueno. */
function Kpi({ label, value, format, change, changeFmt, good, trend, note }) {
  const up = change > 0.0005;
  const down = change < -0.0005;
  const tone = change == null || (!up && !down) ? 'flat' : (up === good ? 'better' : 'worse');
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <div className="kpi">
      <span className="kpi-l">{label}</span>
      <b className="kpi-v"><AnimatedNumber value={value} format={format} fromZero /></b>
      <div className="kpi-f">
        {change == null ? (
          <span className="delta flat">{note || 'Sin periodo previo para comparar'}</span>
        ) : (
          <span className={`delta ${tone}`}>
            <Icon aria-hidden="true" />{changeFmt(change)}
            <span className="sr-only">{tone === 'better' ? ' (mejora)' : tone === 'worse' ? ' (empeora)' : ''}</span>
          </span>
        )}
        {trend && <Sparkline values={trend} label={`Tendencia de ${label.toLowerCase()}`} />}
      </div>
    </div>
  );
}

const relFmt = (d) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} %`;
const ppFmt = (d) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`;

export default function Tablero() {
  const { repo, db } = useStore();
  const now = useNow(60_000);
  const [range, setRange] = useState('7d');
  const [area, setArea] = useState('');
  const p = periodOf(range, now);
  const from = isoDay(p.prevFrom);
  const to = isoDay(p.to);
  // Se vuelve a pedir cuando cambia algún turno de hoy (llegan por tiempo real)
  const live = db.turns.map((t) => `${t.id}${t.state}`).join('|');
  const q = useQuery(() => repo.indicadores(from, to), `${from}|${to}|${live}`);

  const v = useMemo(() => {
    if (!q.data) return null;
    const facts = q.data;
    const cur = slice(facts, p.from, p.to, area);
    const prev = slice(facts, p.prevFrom, p.prevTo, area);
    // Solo se compara si hay datos desde el inicio del periodo anterior (la demo trae unas semanas)
    const comparable = facts.some((f) => f.t0 < p.prevFrom + 2 * DAY);
    const S = summarize(cur);
    const P = comparable ? summarize(prev) : null;
    const byHour = p.range.days === 1;
    const days = series(cur, p.from, p.to, byHour).map((d) => ({ ...d, label: d.label || fmtDay(d.t), title: byHour ? `${d.label} a ${parseInt(d.label, 10) + 1} h` : fmtLongDay(d.t) }));
    const heat = heatmap(cur, p.from, p.to);
    return { cur, S, P, days, heat, dx: topDx(cur), dest: destinos(cur), perfil: perfil(cur), cumpl: cumplimiento(cur), cons: porConsultorio(cur), byHour };
  }, [q.data, p.from, p.to, p.prevFrom, p.prevTo, p.range.days, area]);

  const exportCSV = () => {
    const cols = [
      ['label', v.byHour ? 'Hora' : 'Día', (r) => (v.byHour ? r.label : isoDay(r.t))],
      ['total', 'Turnos'], ['atendidos', 'Atendidos'], ['cancelados', 'Cancelados'],
      ['CRITICA', 'Críticos'], ['PRIORITARIA', 'Prioritarios'], ['NORMAL', 'Normales'],
      ['tiempoTotal', 'Tiempo total medio (min)', (r) => (r.tiempoTotal == null ? '' : Math.round(r.tiempoTotal))],
      ['enObjetivo', 'Dentro del objetivo (%)', (r) => (r.enObjetivo == null ? '' : Math.round(r.enObjetivo * 100))],
    ];
    downloadText(`sgc-indicadores-${isoDay(p.from)}-a-${isoDay(p.to)}${area ? `-${area.replace(' ', '')}` : ''}.csv`, toCSV(cols, v.days), 'text/csv;charset=utf-8');
  };

  const periodText = p.range.days === 1
    ? `Hoy hasta las ${new Date(now).getHours()}:${String(new Date(now).getMinutes()).padStart(2, '0')} h, comparado con el mismo día de la semana pasada`
    : `Del ${fmtLongDay(p.from)} a hoy, comparado con los ${p.range.days} días anteriores`;

  return (
    <>
      <WorkspaceHeader
        title="Tablero gerencial"
        icon="barchart"
        lead="Cómo fluyen los pacientes por el centro de salud: demanda, tiempos de espera, cumplimiento de metas y morbilidad. Los datos son anónimos."
      />

      <div className="filters">
        <Segmented label="Periodo" value={range} onChange={setRange} options={RANGES.map((r) => [r.k, r.n])} />
        <select className="input sm-select" aria-label="Consultorio" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Todos los consultorios</option>
          {AREAS.map((a) => <option key={a}>{a}</option>)}
        </select>
        <span className="period">{periodText}</span>
        <button className="btn sec sm" onClick={exportCSV} disabled={!v}><Download /> Exportar CSV</button>
      </div>

      {q.error && <Msg tone="crit">No se pudieron cargar los indicadores: {q.error}</Msg>}
      {!v ? (
        <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi skeleton" style={{ height: 132 }} />)}</div>
      ) : (
        <div className={`dash ${q.loading ? 'refetch' : ''}`} aria-busy={q.loading}>
          <div className="kpis">
            <Kpi label="Pacientes atendidos" value={v.S.atendidos} format={minFmt} change={v.P && delta(v.S.atendidos, v.P.atendidos)} changeFmt={relFmt} good trend={v.days.map((d) => d.atendidos)} />
            <Kpi label="Tiempo total medio, de la llegada al alta" value={v.S.tiempoTotal} format={fmtMin} change={v.P && delta(v.S.tiempoTotal, v.P.tiempoTotal)} changeFmt={relFmt} good={false} trend={v.days.map((d) => d.tiempoTotal)} />
            <Kpi label="Esperas dentro del tiempo objetivo" value={v.S.enObjetivo} format={fmtPct} change={v.P && v.S.enObjetivo != null && v.P.enObjetivo != null ? v.S.enObjetivo - v.P.enObjetivo : null} changeFmt={ppFmt} good trend={v.days.map((d) => d.enObjetivo)} />
            <Kpi label="Abandono (no se presentó o se retiró)" value={v.S.abandono} format={fmtPct} change={v.P && v.S.abandono != null && v.P.abandono != null ? v.S.abandono - v.P.abandono : null} changeFmt={ppFmt} good={false} trend={v.days.map((d) => d.abandono)} />
          </div>

          <Insights v={v} />

          <div className="dash-grid">
            <Panel title={v.byHour ? 'Llegadas por hora, según prioridad' : 'Turnos por día, según prioridad'} sub="Los cancelados no se incluyen" className="span-2">
              <ColumnChart
                data={v.days.map((d) => ({ label: d.label, title: d.title, values: d }))}
                series={PRIO_SERIES}
                format={minFmt}
                ariaLabel="Turnos por día según prioridad"
              />
            </Panel>
            <Panel title="La ruta: tiempo medio por etapa" sub="Gris: tiempo de espera. Color: tiempo de atención.">
              <StackBar
                ariaLabel="Composición del tiempo total por etapa"
                legend={false}
                height={34}
                segments={v.S.stages.map((s) => ({ k: s.k, label: s.n, value: s.mean || 0, display: fmtMin(s.mean), color: s.wait ? 'var(--wait)' : `var(--st-${s.st})`, ink: s.wait ? 'var(--ink)' : '#fff' }))}
              />
              <ol className="stage-list">
                {v.S.stages.map((s) => (
                  <li key={s.k}>
                    <i style={{ background: s.wait ? 'var(--wait)' : `var(--st-${s.st})` }} aria-hidden="true" />
                    <span>{s.n}</span>
                    <b>{fmtMin(s.mean)}</b>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title={v.byHour ? 'Espera media por hora' : 'Espera media por día'} sub="Minutos hasta el llamado de cada etapa" className="span-2">
              <LineChart
                data={v.days.map((d) => ({ label: d.label, title: d.title, values: d }))}
                series={[
                  { k: 'espTri', label: 'Espera de triaje', short: 'triaje', color: 'var(--st-enf)' },
                  { k: 'espMed', label: 'Espera de consulta', short: 'consulta', color: 'var(--st-med)' },
                ]}
                format={minFmt}
                unit=" min"
                ariaLabel="Minutos de espera por día"
              />
            </Panel>
            <Panel title="Cumplimiento del tiempo objetivo" sub="Espera para consulta según prioridad de triaje">
              <div className="meters">
                {v.cumpl.map((c) => (
                  <Meter key={c.prio} label={PRIO[c.prio][0]} sub={`Objetivo: ≤ ${WAIT_TARGET[c.prio]} min`} rate={c.rate} detail={`${c.ok} de ${c.n}`} />
                ))}
              </div>
            </Panel>

            <Panel title="Demanda: llegadas por hora" sub="Promedio por día de la semana en el periodo" className="span-2">
              <Heatmap data={v.heat} ariaLabel="Llegadas promedio por día de la semana y hora" />
            </Panel>
            <Panel title="Destino de los pacientes">
              <StackBar
                ariaLabel="Destino de los pacientes atendidos"
                segments={v.dest.map((d) => ({ k: d.k, label: d.k, value: d.n, color: DEST_COLOR[d.k], display: fmtNum(d.n), legendValue: `${fmtNum(d.n)} (${d.total ? Math.round((d.n / d.total) * 100) : 0} %)` }))}
              />
            </Panel>

            <Panel title="Morbilidad: diagnósticos más frecuentes" sub="Códigos CIE-10 registrados en el periodo" className="span-2">
              <BarList
                color="var(--cat-1)"
                total={v.dx.reduce((s, d) => s + d.n, 0)}
                rows={v.dx.map((d) => ({ k: d.code, label: d.code, sub: d.desc, value: d.n }))}
                format={fmtNum}
              />
            </Panel>
            <Panel title="Perfil de los pacientes" sub={`${fmtNum(v.perfil.total)} turnos con datos del paciente`}>
              <BarList
                color="var(--st-adm)"
                total={v.perfil.total}
                rows={v.perfil.grupos.map((g) => ({ k: g.k, label: g.n, sub: g.range, value: g.count, display: v.perfil.total ? `${Math.round((g.count / v.perfil.total) * 100)} %` : '—' }))}
              />
              <dl className="mini-stats">
                <div><dt>Mujeres</dt><dd>{fmtPct(v.perfil.total ? v.perfil.mujeres / v.perfil.total : null)}</dd></div>
                <div><dt>Con SIS activo</dt><dd>{fmtPct(v.perfil.total ? v.perfil.sis / v.perfil.total : null)}</dd></div>
              </dl>
            </Panel>

            <Panel title="Productividad por consultorio" className="span-3">
              <div className="tblw">
                <table className="tbl">
                  <thead><tr><th>Consultorio</th><th>Médico</th><th className="num">Atenciones</th><th className="num">Consulta media</th><th>Participación</th></tr></thead>
                  <tbody>
                    {v.cons.map((c) => {
                      const share = v.S.atendidos ? c.n / v.S.atendidos : 0;
                      return (
                        <tr key={c.area}>
                          <td>{c.area}</td>
                          <td>{[...c.med.keys()].map((u) => db.users.find((x) => x.u === u)?.n ?? u).join(', ') || '—'}</td>
                          <td className="num">{fmtNum(c.n)}</td>
                          <td className="num">{fmtMin(c.consulta)}</td>
                          <td><span className="share"><i style={{ width: `${share * 100}%` }} /></span> {fmtPct(share)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title={v.byHour ? 'Resumen por hora' : 'Resumen por día'} sub="La misma información de los gráficos, en tabla" className="span-3">
              <div className="tblw">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{v.byHour ? 'Hora' : 'Día'}</th><th className="num">Turnos</th><th className="num">Atendidos</th><th className="num">Cancelados</th>
                      <th className="num">Críticos</th><th className="num">Espera triaje</th><th className="num">Espera consulta</th>
                      <th className="num">Tiempo total</th><th className="num">En objetivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...v.days].reverse().map((d) => (
                      <tr key={d.t}>
                        <td>{d.title}</td><td className="num">{d.total}</td><td className="num">{d.atendidos}</td><td className="num">{d.cancelados}</td>
                        <td className="num">{d.CRITICA}</td><td className="num">{fmtMin(d.espTri)}</td><td className="num">{fmtMin(d.espMed)}</td>
                        <td className="num">{fmtMin(d.tiempoTotal)}</td><td className="num">{fmtPct(d.enObjetivo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

/** Lectura rápida: tres conclusiones calculadas con los datos del periodo. */
function Insights({ v }) {
  const peak = v.heat.cells.flat().reduce((a, c) => (c.avg > (a?.avg ?? 0) ? c : a), null);
  const worst = v.cumpl.filter((c) => c.rate != null).sort((a, b) => a.rate - b.rate)[0];
  const top = v.dx[0];
  const items = [
    peak && `La mayor demanda es el ${DOW_NAMES[peak.dow]} de ${peak.h} a ${peak.h + 1} h, con ${peak.avg.toLocaleString('es-PE', { maximumFractionDigits: 1 })} llegadas en promedio.`,
    top && `El diagnóstico más frecuente es ${top.code} (${top.desc.split(' (')[0].toLowerCase()}): ${top.n} casos.`,
    worst && `La prioridad ${PRIO[worst.prio][0].toLowerCase()} es la que menos cumple su meta de espera (${fmtPct(worst.rate)} dentro de ${WAIT_TARGET[worst.prio]} min).`,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <ul className="insights" aria-label="Lectura rápida del periodo">
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}
