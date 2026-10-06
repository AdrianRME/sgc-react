import { createClient } from '@supabase/supabase-js';
import { AUTH_DOMAIN } from '../lib/constants.js';

/*
 * Repositorio sobre Supabase (supabase/schema.sql).
 *
 * Autenticación: Supabase Auth (contraseña bcrypt, sesión JWT). La sesión se guarda en
 * sessionStorage: se pierde al cerrar la pestaña, como corresponde a equipos compartidos.
 *
 * Datos: la app no escribe directamente en las tablas. Llama a funciones de la base:
 *   sgc_cargar()                         → turnos de hoy y abiertos que el rol puede ver (RLS)
 *   sgc_guardar(cambios)                 → valida rol, estados y datos; guarda en una transacción
 *   sgc_historia(p_dni)                  → atenciones de un paciente (Enfermería y Médico); queda auditado
 *   sgc_indicadores(p_desde, p_hasta)    → hechos anónimos para el tablero (solo Jefatura)
 *   sgc_restablecer_demo(datos) + _lote  → carga de demostración por partes (solo Jefatura)
 *   sgc_clave_cambiada()                 → confirma el cambio de una contraseña temporal
 *   sgc_sala()                           → pantalla pública: códigos y destinos, sin datos personales
 */

/** Tamaño de cada parte de la carga de demostración (mantiene las peticiones pequeñas). */
const IMPORT_CHUNK = 150;

/**
 * Divide la semilla de demostración en partes: la primera (pacientes y umbrales) abre la carga y las
 * siguientes llevan los turnos y, al final, la auditoría. Las cuentas de usuario no se envían.
 * La base solo necesita códigos y usuarios: las descripciones las toma de sus catálogos.
 */
export function importParts({ patients, thresholds, turns, audit }) {
  const rows = turns.map((t) => (t.consult
    ? { ...t, consult: { ...t.consult, dx: t.consult.dx.map(([code, , type]) => [code, '', type]), medico: { u: t.consult.medico.u } } }
    : t));
  const parts = [];
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK) parts.push({ turns: rows.slice(i, i + IMPORT_CHUNK) });
  parts.push({ audit, fin: true });
  return { first: { patients, thresholds }, parts };
}

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
  uq_usuario_username: 'Ese usuario ya existe.',
};

export function friendlyError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`;
  const hit = Object.keys(CONSTRAINT_MSG).find((c) => text.includes(c));
  if (hit) return CONSTRAINT_MSG[hit];
  if (/JWT expired|invalid JWT|PGRST30/i.test(text)) return 'Su sesión expiró. Vuelva a iniciar sesión.';
  return error?.message || 'Error desconocido';
}

const AUTH_MSG = [
  [/invalid login credentials/i, 'Usuario o contraseña incorrectos.'],
  [/rate limit|too many/i, 'Demasiados intentos. Espere unos minutos y vuelva a intentar.'],
  [/should be different/i, 'La nueva contraseña debe ser distinta de la actual.'],
  [/weak|at least|characters/i, 'La contraseña es muy débil. Use al menos 8 caracteres con letras y números.'],
  [/fetch|network/i, 'No hay conexión con el servidor.'],
];
const authError = (e) => AUTH_MSG.find(([re]) => re.test(e?.message || ''))?.[1] || e?.message || 'Error de autenticación';

const toEmail = (u) => `${u.trim().toLowerCase()}@${AUTH_DOMAIN}`;
const toAuth = (session) =>
  session
    ? {
        u: session.user?.app_metadata?.sgc_usuario || null,
        // app_metadata solo lo escribe el servidor; el bloqueo real lo aplica la base (sgc_clave_cambiada)
        mustChange: !!session.user?.app_metadata?.debe_cambiar_clave,
      }
    : null;

export function createSupabaseRepo(url, anonKey) {
  const storage = typeof window !== 'undefined' ? window.sessionStorage : undefined;
  const sb = createClient(url, anonKey, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(friendlyError(error));
    return data;
  };

  return {
    kind: 'supabase',
    label: 'Supabase · tiempo real',

    /* ---------- Sesión ---------- */
    async getSession() {
      const { data } = await sb.auth.getSession();
      return toAuth(data.session);
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toAuth(session)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(u, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: toEmail(u), password });
      if (error) throw new Error(authError(error));
      const auth = toAuth(data.session);
      if (!auth?.u) {
        await sb.auth.signOut();
        throw new Error('La cuenta no está habilitada en el sistema. Contacte a Jefatura.');
      }
      return auth;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async changePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(authError(error));
      // La base verifica que ya no es la clave temporal, libera el acceso y audita el cambio
      await call('sgc_clave_cambiada');
      await sb.auth.refreshSession();
    },

    /* ---------- Datos ---------- */
    async load() {
      const db = await call('sgc_cargar');
      if (!db.me) throw new Error('Su usuario no está activo en el sistema. Contacte a Jefatura.');
      return db;
    },
    async save(changes) {
      await call('sgc_guardar', { cambios: changes });
    },
    async reset(seed) {
      const { first, parts } = importParts(seed);
      const token = await call('sgc_restablecer_demo', { datos: first });
      for (const datos of parts) await call('sgc_restablecer_demo_lote', { p_token: token, datos });
      return this.load();
    },
    async historia(dni) {
      return call('sgc_historia', { p_dni: dni });
    },
    async indicadores(desde, hasta) {
      return call('sgc_indicadores', { p_desde: desde, p_hasta: hasta });
    },
    async sala() {
      return call('sgc_sala');
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
