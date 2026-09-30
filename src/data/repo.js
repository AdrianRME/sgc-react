import { createLocalRepo } from './localRepo.js';
import { createSupabaseRepo } from './supabaseRepo.js';

/** Usa Supabase si hay credenciales en .env; si no, localStorage. */
export function createRepo() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? createSupabaseRepo(url, key) : createLocalRepo();
}
