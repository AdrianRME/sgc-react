import { createLocalRepo } from './localRepo.js';
import { createSupabaseRepo } from './supabaseRepo.js';
import { enVisita } from '../lib/entrada.js';

/**
 * De dónde salen los datos: en modo visita, de una copia de demostración guardada solo en este navegador
 * (nada llega a la base real); si no, de Supabase cuando hay credenciales en .env, o de localStorage.
 */
export function createRepo() {
  if (enVisita()) {
    return createLocalRepo({ key: 'sgc-visita-db-v1', sessionKey: 'sgc-visita-sesion', kind: 'visita', label: 'Modo visita · datos de demostración' });
  }
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? createSupabaseRepo(url, key) : createLocalRepo();
}
