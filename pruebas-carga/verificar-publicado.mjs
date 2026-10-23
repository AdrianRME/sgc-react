/*
 * Verificación H5 · lista del paso 7 de DESPLIEGUE.md contra el proyecto de Supabase publicado.
 *
 * Usa las mismas acciones de src/store/actions.js que la app y guarda con sgc_guardar(), así que la base
 * aplica sus reglas igual que con la interfaz. Además intenta cambios prohibidos armados a mano (sin pasar
 * por las reglas de la app) para comprobar que el servidor los rechaza, y mide la latencia real de las RPC.
 *
 * Crea un paciente ficticio y un usuario de prueba (que deja desactivado). No usa datos reales.
 *
 * Uso: node pruebas-carga/verificar-publicado.mjs   (lee VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY de .env)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  createTurn, registerPayment, callTurn, startTriage, saveTriage, assignCita, checkIn, startConsult, finishConsult,
  saveHorario, removeHorario, createUser, toggleUser,
} from '../src/store/actions.js';
import { especialidadSugerida, sugerirCita, sameDay } from '../src/lib/agenda.js';
import { AUTH_DOMAIN } from '../src/lib/constants.js';
import { buildSeed } from '../src/lib/seed.js';
import { importParts } from '../src/data/supabaseRepo.js';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_SB = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
const CLAVE = 'SgcDemo2026';

const results = [];
const times = [];
const log = (item, ok, detalle) => {
  results.push({ item, ok, detalle });
  console.log(`${ok ? 'CUMPLE ' : 'FALLA  '} ${item}: ${detalle}`);
};

const clients = {};
async function session(u) {
  if (clients[u]) return clients[u];
  const sb = createClient(URL_SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (u !== 'anon') {
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${AUTH_DOMAIN}`, password: CLAVE });
    if (error) throw new Error(`No inicia sesión ${u}: ${error.message}`);
  }
  return (clients[u] = sb);
}
async function rpc(u, fn, args) {
  const sb = await session(u);
  const t0 = performance.now();
  const { data, error } = await sb.rpc(fn, args);
  times.push({ fn, ms: performance.now() - t0 });
  if (error) throw new Error(error.message);
  return data;
}
const load = (u) => rpc(u, 'sgc_cargar');
const ctxOf = (db, u, area) => ({ user: db.users.find((x) => x.u === u), area, now: Date.now(), ip: '' });
// El servidor fija la hora de creación (t0), así que el turno se ubica por código y día
const find = (db, id, t0) => db.turns.find((t) => t.id === id && (t0 ? t.t0 === t0 : sameDay(t.t0, Date.now())));

/** Ejecuta una acción de la app como el usuario u y la guarda en el servidor. */
async function act(u, area, action, ...args) {
  const db = await load(u);
  const r = action(db, ctxOf(db, u, area), ...args);
  await rpc(u, 'sgc_guardar', { cambios: r.changes });
  return r;
}
/** Envía un cambio armado a mano; devuelve el mensaje de rechazo del servidor o null si lo aceptó. */
async function rejected(u, cambios) {
  try { await rpc(u, 'sgc_guardar', { cambios }); return null; } catch (e) { return e.message; }
}
const audit = (a, d) => [{ id: `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), a, d, ip: '' }];

async function main() {
  // Tras ejecutar schema.sql la base queda sin turnos: se carga la demostración como lo hace Jefatura en la app
  if ((await load('j.jefatura')).turns.length < 50) {
    const { first, parts } = importParts(buildSeed(Date.now()));
    const token = await rpc('j.jefatura', 'sgc_restablecer_demo', { datos: first });
    for (const datos of parts) await rpc('j.jefatura', 'sgc_restablecer_demo_lote', { p_token: token, datos });
    console.log(`Demostración cargada: ${(await load('j.jefatura')).turns.length} turnos visibles`);
  }
  const dni = String(70500000 + Math.floor(Math.random() * 400000));
  const vitals = { pa: '150/95', fc: 84, fr: 18, t: 36.7, spo2: 97, peso: 78, talla: 1.68, motivo: 'Control de presión arterial' };

  // 1. Admisión registra un paciente sin seguro
  const t = (await act('a.admision', '', createTurn, { dni, form: { nom: 'Paciente', ape: 'Verificación H5', nac: '1980-03-15', sexo: 'M', tel: '' }, sis: 'NO_ASEGURADO' })).result;
  let db = await load('a.admision');
  log('1 Admisión registra paciente sin seguro', find(db, t.id)?.state === 'PENDIENTE_PAGO', `${t.id} (DNI ficticio ${dni}) queda ${find(db, t.id)?.state}`);

  // 2. Caja cobra en efectivo
  const badPay = await rejected('c.caja', { turns: [{ ...find(db, t.id), state: 'EN_ESPERA_TRIAJE', pago: { metodo: 'TRUEQUE', monto: 0, comp: 'X' } }], audit: audit('PAGO_REGISTRADO', 'prueba') });
  await act('c.caja', '', registerPayment, t.id, { metodo: 'EFECTIVO', recibido: 50 });
  db = await load('c.caja');
  const tp = find(db, t.id);
  log('2 Caja cobra y emite boleta', tp?.state === 'EN_ESPERA_TRIAJE' && /^B001-\d{6}$/.test(tp?.pago?.comp || ''), `boleta ${tp?.pago?.comp}, S/ ${tp?.pago?.monto}; pago no válido rechazado: ${badPay ?? 'NO'}`);

  // 3. Enfermería: llamado, triaje y prioridad
  db = await load('e.triaje');
  const ocupado = db.turns.find((x) => x.state === 'EN_TRIAJE');
  if (ocupado) log('3 Triaje', false, `el módulo ya tiene a ${ocupado.id} en triaje; no se interrumpe`);
  else {
    await act('e.triaje', '', callTurn, t.id);
    await act('e.triaje', '', startTriage, t.id);
    await act('e.triaje', '', saveTriage, t.id, vitals, '');
    db = await load('a.admision');
    const tt = find(db, t.id);
    log('3 Enfermería llama, hace el triaje y la base fija la prioridad', tt?.state === 'PENDIENTE_CITA' && !!tt?.prio, `prioridad ${tt?.prio}, pasa a ${tt?.state}`);
  }

  // 4. Cita: el motivo sugiere Cardiología; si hoy no es martes ni jueves, cita otro día
  db = await load('a.admision');
  const tc = find(db, t.id);
  const pac = db.patients.find((p) => p.dni === dni);
  const esp = especialidadSugerida(pac, tc.tri, Date.now());
  const sug = sugerirCita(db, esp, tc.prio, Date.now());
  const fuera = { ...tc, state: 'CITADO', cita: { esp: 'CAR', med: 'm.cardio', at: new Date(new Date().setHours(3, 0, 0, 0) + 86_400_000).getTime(), sobre: false, area: 'Consultorio 3' } };
  const badCita = await rejected('a.admision', { turns: [fuera], audit: audit('CITA_ASIGNADA', 'prueba fuera de horario') });
  await act('a.admision', '', assignCita, t.id, sug.cita);
  db = await load('a.admision');
  const tci = find(db, t.id);
  log('4 Citas sugiere especialidad y cupo según horario', esp === 'CAR' && !!tci?.cita,
    `sugiere ${esp}; cita ${new Date(tci.cita.at).toLocaleString('es-PE')} con ${tci.cita.med}, turno ${tci.state}; cita a las 03:00 rechazada: ${badCita ?? 'NO'}`);

  // 5. Llegada de un citado de hoy
  db = await load('a.admision');
  const citadoHoy = db.turns.find((x) => x.state === 'CITADO' && sameDay(x.cita.at, Date.now()));
  if (!citadoHoy) log('5 Llegada de un citado de hoy', false, 'la demostración no tiene citados de hoy');
  else {
    await act('a.admision', '', checkIn, citadoHoy.id);
    db = await load('a.admision');
    log('5 Admisión registra la llegada de un citado de hoy', find(db, citadoHoy.id, citadoHoy.t0)?.state === 'EN_ESPERA_CONSULTA', `${citadoHoy.id} pasa a la espera de consulta`);
  }

  // 6. Consulta: solo sus pacientes; CR-06; CIE-10, receta y alta
  const AREA = 'Consultorio 1';
  db = await load('m.consulta');
  const abiertos = db.turns.filter((x) => x.state === 'EN_CONSULTA' && x.dest === AREA);
  const mios = db.turns.filter((x) => x.state === 'EN_ESPERA_CONSULTA' && x.cita?.med === 'm.consulta');
  const ajenos = db.turns.filter((x) => x.state === 'EN_ESPERA_CONSULTA' && x.cita && x.cita.med !== 'm.consulta');
  if (abiertos.length) log('6 Consulta', false, `${AREA} ya tiene una atención abierta (${abiertos[0].id}); no se interrumpe`);
  else if (mios.length < 2) log('6 Consulta', false, `se necesitan 2 pacientes en espera de m.consulta y hay ${mios.length}`);
  else {
    const [p1, p2] = mios;
    const otro = await rejected('m.consulta2', { turns: [{ ...p2, state: 'LLAMADO_CONSULTA', dest: 'Consultorio 2', calledAt: Date.now(), calls: 1 }], audit: audit('LLAMADO', 'prueba') });
    await act('m.consulta', AREA, callTurn, p1.id);
    await act('m.consulta', AREA, startConsult, p1.id);
    // CR-06 en la app y en el servidor (cambio armado sin pasar por actions.js)
    db = await load('m.consulta');
    let app = null;
    try { callTurn(db, ctxOf(db, 'm.consulta', AREA), p2.id); } catch (e) { app = e.message; }
    const srv = await rejected('m.consulta', { turns: [{ ...find(db, p2.id, p2.t0), state: 'LLAMADO_CONSULTA', dest: AREA, calledAt: Date.now(), calls: 1 }], audit: audit('LLAMADO', 'prueba CR-06') });
    log('CR-06 bloquea llamar a otro paciente con una atención abierta', !!app && /antes de llamar a otro paciente/.test(srv || ''), `app: ${app ?? 'NO bloquea'} · servidor: ${srv ?? 'NO bloquea'}`);
    const form = { notas: 'Paciente ficticio de verificación', dx: [['J00', 'Rinofaringitis aguda', 'D']], meds: [{ n: 'Paracetamol 500 mg', dosis: '1 tab', frec: 'c/8 h', dias: '3', cant: '9' }], dest: 'Alta', destx: '' };
    await act('m.consulta', AREA, finishConsult, p1.id, { ...form, allergyOverride: true });
    // Un citado de otro día ya cerrado no vuelve en sgc_cargar (solo turnos de hoy o abiertos): se lee en su historia
    const fin = (await rpc('m.consulta', 'sgc_historia', { p_dni: p1.dni })).find((x) => x.id === p1.id && x.t0 === p1.t0);
    log('6 El médico llama, atiende, registra CIE-10 y receta, y finaliza', fin?.state === 'ATENDIDO' && !!fin?.consult?.rec,
      `${p1.id} ATENDIDO, receta ${fin?.consult?.rec}; m.consulta2 llamando a un paciente ajeno: ${otro ?? 'NO rechazado'}`);
  }

  // 7. Horarios: agrega un bloque, rechaza un cruce y lo quita
  db = await load('j.jefatura');
  const base = db.horarios.find((h) => h.on && h.med === 'm.consulta');
  const cruce = await rejected('j.jefatura', { horarios: [{ id: `v-${Date.now()}`, med: 'm.consulta2', dow: base.dow, ini: base.ini, fin: base.fin, area: base.area, on: true }], audit: audit('HORARIO', 'prueba de cruce') });
  const nuevo = { id: `vh-${Date.now().toString(36)}`, med: 'm.pediatria', dow: 7, ini: '08:00', fin: '10:00', area: 'Consultorio 2' };
  // Si una corrida anterior dejó el bloque de prueba, se quita primero
  const previo = db.horarios.find((x) => x.on && x.med === nuevo.med && x.dow === nuevo.dow && x.ini === nuevo.ini);
  if (previo) await act('j.jefatura', '', removeHorario, previo.id);
  let agregado = 'no';
  try {
    await act('j.jefatura', '', saveHorario, nuevo);
    agregado = 'sí';
    const creado = (await load('j.jefatura')).horarios.find((x) => x.on && x.med === nuevo.med && x.dow === nuevo.dow && x.ini === nuevo.ini);
    await act('j.jefatura', '', removeHorario, creado.id);
  } catch (e) { agregado = e.message; }
  log('7 Jefatura agrega un bloque y la base rechaza un cruce de consultorio', agregado === 'sí' && !!cruce, `bloque de domingo agregado y quitado: ${agregado}; cruce rechazado: ${cruce ?? 'NO'}`);

  // 8. Pantalla de sala sin sesión: sin nombres ni DNI
  const sala = await rpc('anon', 'sgc_sala');
  const txt = JSON.stringify(sala);
  log('8 La pantalla de sala no muestra nombres ni DNI', !/\b\d{8}\b/.test(txt) && !txt.includes('Verificación H5'), `${(sala?.llamados || sala || []).length ?? '?'} registros; sin DNI ni nombres`);

  // 9. Un rol no entra a lo de otro (el servidor rechaza aunque se escriba la ruta)
  let ind = null;
  try { await rpc('a.admision', 'sgc_indicadores', { p_desde: new Date().toISOString().slice(0, 10), p_hasta: new Date().toISOString().slice(0, 10) }); } catch (e) { ind = e.message; }
  let hc = null;
  try { await rpc('c.caja', 'sgc_historia', { p_dni: '70000001' }); } catch (e) { hc = e.message; }
  log('9 Admisión y Caja no acceden a datos de Jefatura ni a historias', !!ind && !!hc, `indicadores: ${ind ?? 'NO'} · historia: ${hc ?? 'NO'}`);

  // 10. Usuario nuevo con contraseña temporal
  const nu = `v.h5${Date.now().toString(36).slice(-4)}`;
  const cu = await act('j.jefatura', '', createUser, { u: nu, n: 'Usuario de verificación H5', role: 'adm', col: '', esp: '' });
  const sbN = createClient(URL_SB, KEY, { auth: { persistSession: false } });
  const { error: eN } = await sbN.auth.signInWithPassword({ email: `${nu}@${AUTH_DOMAIN}`, password: cu.result.clave });
  let temp = null;
  if (!eN) { const { data, error } = await sbN.rpc('sgc_cargar'); temp = error?.message ?? (data?.me ? null : 'sgc_cargar no entrega datos (me = null) hasta cambiar la contraseña temporal'); }
  await act('j.jefatura', '', toggleUser, nu);
  log('10 Jefatura crea un usuario y debe cambiar la contraseña temporal', !eN && /contraseña temporal/i.test(temp || ''), `${nu} inicia sesión: ${eN ? eN.message : 'sí'}; sin cambiarla: ${temp ?? 'NO bloquea'}; luego se desactivó`);

  // 11. Tablero gerencial por periodo
  const hoy = new Date();
  const per = [];
  for (const d of [0, 6, 13, 27]) {
    const desde = new Date(hoy.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const r = await rpc('j.jefatura', 'sgc_indicadores', { p_desde: desde, p_hasta: hoy.toISOString().slice(0, 10) });
    per.push(`${d + 1} d: ${(r?.hechos || r || []).length} turnos`);
  }
  log('11 Tablero gerencial responde en los 4 periodos', per.length === 4, per.join(' · '));

  // 12. Historia clínica
  const h = await rpc('m.consulta', 'sgc_historia', { p_dni: '70000001' });
  log('12 El médico consulta la historia de 70000001', (h || []).length > 0, `${(h || []).length} atenciones anteriores`);

  // Latencia real: 30 cargas de Jefatura, sin escritura
  for (let i = 0; i < 30; i++) await load('j.jefatura');
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
main()
  .catch((e) => log('Error', false, e.message))
  .finally(() => {
    const byFn = {};
    for (const { fn, ms } of times) (byFn[fn] ||= []).push(ms);
    const lat = Object.fromEntries(Object.entries(byFn).map(([fn, v]) => [fn, { n: v.length, mediana: +pct(v, 50).toFixed(1), p95: +pct(v, 95).toFixed(1) }]));
    console.table(lat);
    const out = { fecha: new Date().toISOString(), proyecto: URL_SB.replace(/https?:\/\/([^.]+).*/, '$1'), results, latencia_ms: lat };
    writeFileSync(new URL('./resultados/verificacion-publicado.json', import.meta.url), JSON.stringify(out, null, 2));
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  });
