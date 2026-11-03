/**
 * Supervisión de pacientes sensibles: la escalada automática. Se deduce de las marcas de tiempo de cada turno,
 * así funciona igual con Supabase y en modo local. Cada alerta dura mientras la situación siga y le llega a
 * quien puede resolverla:
 *   · urgencia (signo de alarma) que espera triaje más de WAIT_TARGET.urgTri minutos;
 *   · paciente crítico que terminó el triaje y sigue sin sobrecupo más de WAIT_TARGET.CRITICA minutos;
 *   · paciente crítico o prioritario que espera consulta más que su tiempo objetivo.
 * El sistema no decide por el personal: avisa, y la acción (llamar, dar sobrecupo, derivar) es humana.
 */
import { PRIO } from './constants.js';
import { turnKey, waitInfo } from './clinical.js';

const ALERTAS = [
  {
    k: 'urgencia',
    of: (t) => t.state === 'EN_ESPERA_TRIAJE' && t.urg,
    para: ['enf', 'adm', 'jef'],
    texto: (t, w) => `${t.id} llegó con un signo de alarma (${t.urg.toLowerCase()}) y espera triaje hace ${w.min} min. Objetivo: ${w.target} min.`,
    accion: 'Llámelo a triaje ahora.',
  },
  {
    k: 'sobrecupo',
    of: (t) => t.state === 'PENDIENTE_CITA' && t.prio === 'CRITICA',
    para: ['adm', 'enf', 'jef'],
    texto: (t, w) => `${t.id} es un paciente crítico y lleva ${w.min} min sin sobrecupo. Objetivo: ${w.target} min.`,
    accion: 'Asígnele un sobrecupo para hoy o derívelo.',
  },
  {
    k: 'consulta',
    of: (t) => t.state === 'EN_ESPERA_CONSULTA' && ['CRITICA', 'PRIORITARIA'].includes(t.prio),
    para: ['med', 'jef'],
    texto: (t, w) => `${t.id} (prioridad ${PRIO[t.prio][0].toLowerCase()}) espera consulta hace ${w.min} min. Objetivo: ${w.target} min.`,
    accion: 'Llámelo en cuanto se libere el consultorio.',
  },
];

/** Alertas vigentes, de la más grave a la menos grave. `med` es el médico de la cita (si la tiene). */
export function escalaciones(turns, now) {
  const out = [];
  for (const t of turns) {
    const a = ALERTAS.find((x) => x.of(t));
    if (!a) continue;
    const w = waitInfo(t, now);
    if (!w.late) continue;
    out.push({
      key: `${a.k}:${turnKey(t)}`, id: t.id, k: a.k, para: a.para, med: t.cita?.med ?? null,
      tone: t.prio === 'PRIORITARIA' ? 'warn' : 'crit', texto: a.texto(t, w), accion: a.accion, min: w.min,
    });
  }
  const peso = (x) => (x.tone === 'crit' ? 0 : 1);
  return out.sort((a, b) => peso(a) - peso(b) || b.min - a.min);
}

/** Las alertas que le corresponden a un usuario: a cada médico solo las de sus citados (o sin cita). */
export const escalacionesPara = (lista, user) =>
  lista.filter((x) => x.para.includes(user.role) && (user.role !== 'med' || !x.med || x.med === user.u));
