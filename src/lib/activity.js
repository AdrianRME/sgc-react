/**
 * Avisos para el centro de notificaciones: se deducen comparando dos cargas de datos consecutivas,
 * así funcionan igual con Supabase (tiempo real) y en modo local. No se avisa de lo que hizo uno mismo.
 */
import { PRIO } from './constants.js';
import { latestThresholds, turnKey } from './clinical.js';

/** Qué cambios le interesan a cada rol. */
const INTEREST = {
  adm: ['nuevo', 'atendido', 'cancelado'],
  enf: ['nuevo', 'cancelado', 'umbrales'],
  med: ['triaje', 'cancelado', 'umbrales'],
  jef: ['nuevo', 'critico', 'atendido', 'cancelado'],
};

function turnEvents(prev, next) {
  const before = new Map(prev.turns.map((t) => [turnKey(t), t]));
  const out = [];
  for (const t of next.turns) {
    const o = before.get(turnKey(t));
    if (!o) {
      if (t.state === 'EN_ESPERA_TRIAJE') out.push({ k: 'nuevo', by: t.adm, tone: 'info', icon: 'ticket', text: `Nuevo turno ${t.id} en espera de triaje.` });
      continue;
    }
    if (o.state === t.state) continue;
    if (t.state === 'EN_ESPERA_CONSULTA' && o.state === 'EN_TRIAJE') {
      const crit = t.prio === 'CRITICA';
      out.push({ k: 'triaje', by: t.enf, tone: crit ? 'crit' : t.prio === 'PRIORITARIA' ? 'warn' : 'info', icon: crit ? 'warning' : 'clipboard',
        text: `${t.id} pasó a consulta con prioridad ${PRIO[t.prio]?.[0].toLowerCase() ?? 'sin definir'}.` });
      if (crit) out.push({ k: 'critico', by: t.enf, tone: 'crit', icon: 'warning', text: `Paciente crítico en espera: ${t.id}.` });
    }
    if (t.state === 'ATENDIDO') out.push({ k: 'atendido', by: t.med, tone: 'ok', icon: 'check', text: `${t.id} fue atendido (${t.consult?.dest?.toLowerCase() ?? 'alta'}).` });
    if (t.state === 'CANCELADO') out.push({ k: 'cancelado', by: t.cancel?.by, tone: 'warn', icon: 'hourglass', text: `${t.id} se cerró: ${t.cancel?.motivo?.toLowerCase() ?? 'cancelado'}.` });
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
    .filter((e) => wanted.includes(e.k) && e.by !== me.u);
}
