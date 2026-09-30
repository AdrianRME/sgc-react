import { createClient } from '@supabase/supabase-js';
import { buildSeed } from '../lib/seed.js';

/*
 * Repositorio sobre Supabase con el modelo de 13 tablas (supabase/schema.sql).
 * La app no escribe directamente en las tablas: llama a tres funciones de la base,
 * que traducen entre el formato de la app y el modelo relacional:
 *   sgc_cargar()          → { users, patients, turns, audit, thresholds }
 *   sgc_guardar(cambios)  → guarda los cambios de una acción en una sola transacción
 *   sgc_restablecer()     → vacía los datos (los catálogos se conservan)
 */

// Tablas que avisan cambios en tiempo real (cada acción toca al menos una).
const REALTIME_TABLES = ['usuario', 'paciente', 'historia_clinica', 'turno', 'umbral_clinico', 'auditoria'];

// Mensajes claros para las restricciones que pueden fallar por uso simultáneo.
const CONSTRAINT_MSG = {
  uq_turno_activo_paciente: 'El paciente ya tiene un turno activo registrado desde otra estación.',
  uq_turno_consultorio_ocupado: 'Ese consultorio ya está atendiendo a otro paciente.',
  uq_turno_triaje_ocupado: 'Ya hay un paciente en triaje.',
  uq_turno_codigo_dia: 'Otra estación generó el mismo código de turno. Intente de nuevo.',
  uq_receta_codigo: 'Otra estación emitió el mismo número de receta. Intente de nuevo.',
  uq_historia_numero: 'Otra estación generó el mismo número de historia clínica. Intente de nuevo.',
};

export function friendlyError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`;
  const hit = Object.keys(CONSTRAINT_MSG).find((c) => text.includes(c));
  return hit ? CONSTRAINT_MSG[hit] : error?.message || 'Error desconocido';
}

export function createSupabaseRepo(url, anonKey) {
  const sb = createClient(url, anonKey);

  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(friendlyError(error));
    return data;
  };
  const fetchAll = () => call('sgc_cargar');
  const insertAll = (db) => call('sgc_guardar', { cambios: db });

  return {
    kind: 'supabase',
    label: 'Supabase · tiempo real',
    async load() {
      const db = await fetchAll();
      if (!db.users.length) {
        await insertAll(buildSeed());
        return fetchAll();
      }
      return db;
    },
    async save(changes) {
      await call('sgc_guardar', { cambios: changes });
    },
    async reset() {
      await call('sgc_restablecer');
      await insertAll(buildSeed());
      return fetchAll();
    },
    subscribe(onChange) {
      let timer;
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, 150);
      };
      const ch = sb.channel('sgc-cambios');
      REALTIME_TABLES.forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, debounced));
      ch.subscribe();
      return () => {
        clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
  };
}
