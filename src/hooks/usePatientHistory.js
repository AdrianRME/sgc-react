import { useStore } from '../store/useStore.js';
import { useQuery } from './useQuery.js';

/**
 * Atenciones de un paciente (todas las fechas), pedidas al servidor solo cuando se necesitan.
 * Se vuelve a pedir cuando cambia algo de ese paciente en los turnos de hoy (p. ej., al cerrar la consulta).
 */
export function usePatientHistory(dni) {
  const { repo, db } = useStore();
  const todayKey = db.turns.filter((t) => t.dni === dni).map((t) => `${t.id}:${t.state}`).join(',');
  const q = useQuery(() => (dni ? repo.historia(dni) : Promise.resolve([])), `${dni}|${todayKey}`);
  const visits = (q.data || []).slice().sort((a, b) => b.t0 - a.t0);
  return { ...q, visits, attended: visits.filter((t) => t.consult) };
}
