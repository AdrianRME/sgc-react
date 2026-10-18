/**
 * Avisos para el centro de notificaciones: se deducen comparando dos cargas de datos consecutivas,
 * así funcionan igual con Supabase (tiempo real) y en modo local. No se avisa de lo que hizo uno mismo.
 */
import { PRIO } from './constants.js';
import { latestThresholds, turnKey } from './clinical.js';
import { fmtHora } from './format.js';

/** Qué cambios le interesan a cada rol. */
const INTEREST = {
  adm: ['cita', 'atendido', 'cancelado'],
  caj: ['cobro', 'cancelado'],
  enf: ['nuevo', 'cancelado', 'umbrales'],
  med: ['consulta', 'cancelado', 'umbrales'],
  jef: ['nuevo', 'critico', 'atendido', 'cancelado'],
};

function turnEvents(prev, next) {
  const before = new Map(prev.turns.map((t) => [turnKey(t), t]));
  const out = [];
  for (const t of next.turns) {
    const o = before.get(turnKey(t));
    const med = t.cita?.med; // los avisos de consulta solo le llegan al médico de la cita
    if (!o) {
      if (t.state === 'PENDIENTE_PAGO') out.push({ k: 'cobro', by: t.adm, tone: 'info', icon: 'scroll', text: `Nuevo turno ${t.id} por cobrar.` });
      if (t.state === 'EN_ESPERA_TRIAJE') out.push({ k: 'nuevo', by: t.adm, tone: 'info', icon: 'ticket', text: `Nuevo turno ${t.id} en espera de triaje (SIS).` });
      continue;
    }
    if (o.state === t.state) continue;
    if (t.state === 'EN_ESPERA_TRIAJE' && o.state === 'PENDIENTE_PAGO') {
      out.push({ k: 'nuevo', by: t.pago?.by, tone: 'info', icon: 'ticket', text: `${t.id} pagó y está en espera de triaje.` });
    }
    if (t.state === 'PENDIENTE_CITA' && o.state === 'EN_TRIAJE') {
      const crit = t.prio === 'CRITICA';
      out.push({ k: 'cita', by: t.enf, tone: crit ? 'crit' : t.prio === 'PRIORITARIA' ? 'warn' : 'info', icon: crit ? 'warning' : 'calendar',
        text: `${t.id} terminó el triaje (prioridad ${PRIO[t.prio]?.[0].toLowerCase() ?? 'sin definir'}): asigne su cita.` });
      if (crit) out.push({ k: 'critico', by: t.enf, tone: 'crit', icon: 'warning', text: `Paciente crítico ${t.id}: necesita sobrecupo hoy.` });
    }
    if (t.state === 'EN_ESPERA_CONSULTA' && ['PENDIENTE_CITA', 'CITADO'].includes(o.state)) {
      const crit = t.prio === 'CRITICA';
      out.push({ k: 'consulta', by: t.cita?.by, med, tone: crit ? 'crit' : 'info', icon: crit ? 'warning' : 'stethoscope',
        text: `${t.id} espera su consulta${t.cita ? ` (cita de las ${fmtHora(t.cita.at)})` : ''}${crit ? ': prioridad crítica' : ''}.` });
    }
    if (t.state === 'ATENDIDO') out.push({ k: 'atendido', by: t.med, tone: 'ok', icon: 'check', text: `${t.id} fue atendido (${t.consult?.dest?.toLowerCase() ?? 'alta'}).` });
    if (t.state === 'CANCELADO') out.push({ k: 'cancelado', by: t.cancel?.by, med, tone: 'warn', icon: 'hourglass', text: `${t.id} se cerró: ${t.cancel?.motivo?.toLowerCase() ?? 'cancelado'}.` });
  }
  return out;
}

function thresholdEvents(prev, next) {
  const latest = (db) => latestThresholds(db.thresholds)?.since;
  return latest(next) && latest(prev) && latest(next) !== latest(prev)
    ? [{ k: 'umbrales', tone: 'warn', icon: 'knobs', text: 'Jefatura actualizó los umbrales clínicos de triaje.' }]
    : [];
}

/** Eventos nuevos entre dos estados de la base, filtrados para el rol y sin los propios. */
export function diffEvents(prev, next, me) {
  if (!prev || !next || !me) return [];
  const wanted = INTEREST[me.role] || [];
  return [...turnEvents(prev, next), ...thresholdEvents(prev, next)]
    .filter((e) => wanted.includes(e.k) && e.by !== me.u && (me.role !== 'med' || !e.med || e.med === me.u));
}
