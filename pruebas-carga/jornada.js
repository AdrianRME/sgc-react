/*
 * Prueba de carga · jornada simulada con 10 estaciones a la vez (RNF-01, RNF-02).
 *
 * Cada usuario virtual es una estación con su cuenta de demostración y repite su trabajo
 * con las mismas reglas de src/store/actions.js: Admisión registra y cita, Caja cobra,
 * Enfermería hace el triaje, dos médicos atienden, Jefatura mira los indicadores y dos
 * pantallas de sala consultan sgc_sala() cada 3 s. Todas recargan sgc_cargar() después de
 * cada acción, como hace la app cuando llega un aviso de tiempo real.
 *
 * Todos los pacientes y datos son ficticios. La jornada está comprimida: un paso que en un
 * centro de salud toma minutos aquí toma segundos, así que los tiempos por etapa que quedan
 * en la base miden la simulación, no la atención real.
 *
 * Uso: k6 run -e API=http://127.0.0.1:18080 -e TOKENS=tokens.json -e PACIENTES=40 jornada.js
 */
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API || 'http://127.0.0.1:18080';
const TOKENS = JSON.parse(open(__ENV.TOKENS || './tokens.json'));
const PACIENTES = +(__ENV.PACIENTES || 40);
const DURACION = __ENV.DURACION || '12m';

const rpcTime = new Trend('rpc_ms', true);
const okWrites = new Counter('escrituras_ok');
const domainRejects = new Counter('rechazos_de_regla');   // reglas de negocio (esperables con uso simultáneo)
const unexpected = new Counter('errores_inesperados');
const finished = new Counter('turnos_atendidos');

const STATIONS = [
  { name: 'admision', user: 'a.admision', role: 'adm' },
  { name: 'caja', user: 'c.caja', role: 'caj' },
  { name: 'triaje', user: 'e.triaje', role: 'enf' },
  { name: 'consultorio1', user: 'm.consulta', role: 'med', area: 'Consultorio 1' },
  { name: 'consultorio2', user: 'm.consulta2', role: 'med', area: 'Consultorio 2' },
  { name: 'jefatura', user: 'j.jefatura', role: 'jef' },
  { name: 'sala1', user: 'anon', role: 'sala' },
  { name: 'sala2', user: 'anon', role: 'sala' },
  { name: 'pediatria_lectura', user: 'm.pediatria', role: 'lectura' },
  { name: 'cardiologia_lectura', user: 'm.cardio', role: 'lectura' },
];

export const options = {
  scenarios: {
    jornada: { executor: 'per-vu-iterations', vus: STATIONS.length, iterations: 1, maxDuration: DURACION },
  },
  thresholds: {
    'rpc_ms{fn:sgc_cargar}': ['p(95)<1500'],
    'rpc_ms{fn:sgc_guardar}': ['p(95)<1500'],
    'rpc_ms{fn:sgc_sala}': ['p(95)<1500'],
    'rpc_ms{fn:sgc_indicadores}': ['p(95)<1500'],
    errores_inesperados: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max', 'count'],
};

const PRIO_RANK = { CRITICA: 0, PRIORITARIA: 1, NORMAL: 2 };
const TRIAGE_STATION = 'Módulo de Triaje 1';

function rpc(user, fn, body, station) {
  const res = http.post(`${API}/rpc/${fn}`, JSON.stringify(body || {}), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[user]}`, 'X-Forwarded-For': '10.0.0.' + (exec.vu.idInTest) },
    tags: { fn, estacion: station },
  });
  rpcTime.add(res.timings.duration, { fn, estacion: station });
  if (res.status >= 200 && res.status < 300) return { ok: true, data: res.body ? res.json() : null };
  const json = (res.headers['Content-Type'] || '').includes('json');
  return { ok: false, status: res.status, msg: json ? res.json().message : res.body };
}

function save(st, cambios) {
  const r = rpc(st.user, 'sgc_guardar', { cambios }, st.name);
  if (r.ok) { okWrites.add(1, { estacion: st.name }); return true; }
  // P0001 / 42501 / 23505 son reglas de la base o choques entre estaciones: la app avisa y el usuario reintenta
  if (r.status === 400 || r.status === 409 || r.status === 403) domainRejects.add(1, { estacion: st.name });
  else unexpected.add(1, { estacion: st.name });
  console.warn(`RECHAZO ${st.name} ${r.status} ${(cambios.turns || []).map((t) => `${t.id}->${t.state}`).join(',')}: ${r.msg}`);
  return false;
}

const audit = (a, d) => [{ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, a, d }];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pad = (n, w) => String(n).padStart(w, '0');
const maxNum = (vals, re) => vals.reduce((mx, v) => { const m = re.exec(v || ''); return m ? Math.max(mx, +m[1]) : mx; }, 0);
const isToday = (ms) => new Date(ms).toDateString() === new Date().toDateString();
const current = (t) => isToday(t.t0) || !['ATENDIDO', 'CANCELADO'].includes(t.state);

/** Signos vitales ficticios: ~9 % con saturación crítica, ~23 % con fiebre (alerta), el resto normal. */
function vitals() {
  const r = Math.random();
  const base = { pa: `${110 + Math.floor(Math.random() * 25)}/${70 + Math.floor(Math.random() * 15)}`, fc: 72 + Math.floor(Math.random() * 20),
    fr: 16 + Math.floor(Math.random() * 4), t: 36.5, spo2: 97, peso: 55 + Math.floor(Math.random() * 30), talla: 1.55 + Math.random() * 0.25,
    motivo: pick(['Tos y dolor de garganta', 'Dolor abdominal', 'Control de presión', 'Fiebre', 'Dolor de cabeza']) };
  if (r < 0.09) return { ...base, spo2: 88, fc: 112, motivo: 'Dificultad para respirar' };
  if (r < 0.32) return { ...base, t: 38.6 };
  base.talla = Math.round(base.talla * 100) / 100;
  return base;
}

/** Primer cupo libre de hoy del médico, en su horario y después de ahora (mismas reglas de agenda.js). */
function freeSlot(db, med) {
  const dur = 20 * 60000;
  const h = db.horarios.filter((x) => x.on && x.med === med && x.dow === ((new Date().getDay() + 6) % 7) + 1);
  const taken = new Set(db.turns.filter((t) => t.cita && t.cita.med === med && !t.cita.sobre && current(t)).map((t) => t.cita.at));
  const now = Date.now();
  for (const b of h) {
    const [hi, mi] = b.ini.split(':').map(Number);
    const [hf, mf] = b.fin.split(':').map(Number);
    const d0 = new Date(); d0.setHours(hi, mi, 0, 0);
    const d1 = new Date(); d1.setHours(hf, mf, 0, 0);
    for (let s = d0.getTime(); s + dur <= d1.getTime(); s += dur) if (s > now && !taken.has(s)) return { at: s, area: b.area };
  }
  return null;
}

/* ---------------- estaciones ---------------- */

function admision(st) {
  let creados = 0;
  let hc = 900000 + exec.vu.idInTest * 1000;
  while (true) {
    const db = rpc(st.user, 'sgc_cargar', {}, st.name).data;
    // 1) cita para los que salieron de triaje
    for (const t of db.turns.filter((x) => x.state === 'PENDIENTE_CITA')) {
      const med = pick(['m.consulta', 'm.consulta2']);
      const crit = t.prio === 'CRITICA';
      const slot = crit ? { at: Date.now(), area: med === 'm.consulta' ? 'Consultorio 1' : 'Consultorio 2' } : freeSlot(db, med);
      if (!slot) continue;
      const cita = { esp: 'MG', med, at: slot.at, sobre: crit, area: slot.area };
      save(st, { turns: [{ ...t, state: 'EN_ESPERA_CONSULTA', cita, tCita: Date.now(), llego: Date.now(), tLlega: Math.max(Date.now(), slot.at) }],
        audit: audit('CITA_ASIGNADA', `${t.id} → MG con ${med}`) });
      sleep(1);
    }
    // 2) llegada de un paciente nuevo
    if (creados < PACIENTES) {
      const dni = String(70000000 + Math.floor(Math.random() * 9999999)).padStart(8, '0');
      const sis = Math.random() < 0.7 ? 'ACTIVO' : 'NO_ASEGURADO';
      const id = 'TR-' + pad(maxNum(db.turns.filter(current).map((t) => t.id), /^TR-(\d+)$/) + 1, 3);
      const patient = { dni, nom: 'Paciente', ape: `Simulado ${pad(creados + 1, 3)}`, nac: '1985-06-15', sexo: pick(['M', 'F']),
        tel: '', sis, hc: 'HC-' + pad(++hc, 6), ant: '', alg: '' };
      const turn = { id, dni, adm: st.user, state: sis === 'ACTIVO' ? 'EN_ESPERA_TRIAJE' : 'PENDIENTE_PAGO', prio: null, t0: Date.now() };
      if (save(st, { patients: [patient], turns: [turn], audit: audit('TURNO_CREADO', `${id} registrado`) })) creados++;
    }
    const abiertos = db.turns.filter((t) => current(t) && !['ATENDIDO', 'CANCELADO'].includes(t.state)).length;
    if (creados >= PACIENTES && abiertos === 0) break;
    sleep(2 + Math.random() * 3);   // llegada cada ~2 a 5 s (jornada comprimida)
  }
}

function caja(st) {
  while (!done()) {
    const db = rpc(st.user, 'sgc_cargar', {}, st.name).data;
    const t = db.turns.filter((x) => x.state === 'PENDIENTE_PAGO').sort((a, b) => a.t0 - b.t0)[0];
    if (t) {
      const comp = 'B001-' + pad(Math.max(db.meta.compMax || 0, maxNum(db.turns.map((x) => x.pago && x.pago.comp), /^B001-(\d+)$/)) + 1, 6);
      save(st, { turns: [{ ...t, state: 'EN_ESPERA_TRIAJE', tPago: Date.now(), pago: { metodo: pick(['EFECTIVO', 'TARJETA', 'BILLETERA']), monto: 20, comp } }],
        audit: audit('PAGO_REGISTRADO', `${t.id} · ${comp}`) });
      sleep(2);
    } else sleep(1.5);
  }
}

/*
 * Triaje y consulta avanzan según lo que la estación ve en pantalla, como en la app: primero
 * termina al paciente que ya tiene en curso, luego inicia al que llamó y recién después llama al siguiente.
 */
function triaje(st) {
  while (!done()) {
    const db = rpc(st.user, 'sgc_cargar', {}, st.name).data;
    const enCurso = db.turns.find((x) => x.state === 'EN_TRIAJE');
    const llamado = db.turns.find((x) => x.state === 'LLAMADO_TRIAJE');
    if (enCurso) {
      sleep(2 + Math.random() * 2);   // toma de signos vitales
      save(st, { turns: [{ ...enCurso, state: 'PENDIENTE_CITA', tri: vitals(), tTriSave: Date.now() }], audit: audit('TRIAJE_GUARDADO', enCurso.id) });
    } else if (llamado) {
      sleep(1);                        // el paciente llega al módulo
      save(st, { turns: [{ ...llamado, state: 'EN_TRIAJE', enf: st.user }] });
    } else {
      const t = db.turns.filter((x) => x.state === 'EN_ESPERA_TRIAJE').sort((a, b) => a.t0 - b.t0)[0];
      if (!t) { sleep(1.5); continue; }
      save(st, { turns: [{ ...t, state: 'LLAMADO_TRIAJE', dest: TRIAGE_STATION }], audit: audit('LLAMADO', `${t.id} → ${TRIAGE_STATION}`) });
    }
  }
}

function nextRecipe(db) {
  const year = new Date().getFullYear();
  return `REC-${year}-` + pad(Math.max(db.meta.recMax || 0, maxNum(db.turns.map((x) => x.consult && x.consult.rec), new RegExp(`^REC-${year}-(\\d+)$`))) + 1, 6);
}

function medico(st) {
  while (!done()) {
    const db = rpc(st.user, 'sgc_cargar', {}, st.name).data;
    const enCurso = db.turns.find((x) => x.state === 'EN_CONSULTA' && x.med === st.user);
    const llamado = db.turns.find((x) => x.state === 'LLAMADO_CONSULTA' && x.dest === st.area);
    if (enCurso) {
      sleep(3 + Math.random() * 3);   // consulta
      const fresh = rpc(st.user, 'sgc_cargar', {}, st.name).data;
      const consult = { notas: 'Paciente simulado. Examen clínico sin hallazgos de alarma.', dx: [[pick(['J00', 'J06.9', 'R50.9', 'K29.7', 'I10', 'A09']), '', 'P']],
        meds: [{ n: 'Paracetamol 500 mg', dosis: '1 tableta', frec: 'cada 8 horas', dias: 3, cant: '' }], dest: 'Alta', destx: '',
        area: st.area, rec: nextRecipe(fresh) };
      // si el otro consultorio tomó el mismo número de receta, la base lo rechaza y la próxima vuelta recalcula
      if (save(st, { turns: [{ ...enCurso, state: 'ATENDIDO', tEnd: Date.now(), consult }], audit: audit('ATENCION_FINALIZADA', `${enCurso.id} · ${consult.rec}`) })) finished.add(1);
    } else if (llamado) {
      sleep(1);
      save(st, { turns: [{ ...llamado, state: 'EN_CONSULTA', med: st.user }], audit: audit('HC_CONSULTADA', `${llamado.id} abierta en consulta`) });
    } else {
      const t = db.turns.filter((x) => x.state === 'EN_ESPERA_CONSULTA' && x.cita && x.cita.med === st.user)
        .sort((a, b) => (PRIO_RANK[a.prio] - PRIO_RANK[b.prio]) || (a.tLlega - b.tLlega))[0];
      if (!t) { sleep(1.5); continue; }
      save(st, { turns: [{ ...t, state: 'LLAMADO_CONSULTA', dest: st.area }], audit: audit('LLAMADO', `${t.id} → ${st.area}`) });
    }
  }
}

function jefatura(st) {
  const hoy = new Date().toISOString().slice(0, 10);
  while (!done()) {
    rpc(st.user, 'sgc_cargar', {}, st.name);
    rpc(st.user, 'sgc_indicadores', { p_desde: hoy, p_hasta: hoy }, st.name);
    sleep(10);
  }
}

function sala(st) {
  while (!done()) { rpc(st.user, 'sgc_sala', {}, st.name); sleep(3); }
}

function lectura(st) {
  while (!done()) { rpc(st.user, 'sgc_cargar', {}, st.name); sleep(2); }
}

/** Las estaciones de apoyo terminan cuando ya no quedan turnos abiertos y Admisión registró a todos. */
let lastCheck = 0;
function done() {
  // Control del propio script (no es una estación): no se cuenta en rpc_ms
  if (Date.now() - lastCheck < 5000) return false;
  lastCheck = Date.now();
  const res = http.post(`${API}/rpc/sgc_cargar`, '{}', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS['j.jefatura']}` }, tags: { fn: 'control' },
  });
  if (res.status !== 200) return false;
  const turns = res.json().turns.filter(current);
  return turns.length >= PACIENTES && turns.every((t) => ['ATENDIDO', 'CANCELADO'].includes(t.state));
}

export default function () {
  const st = STATIONS[exec.vu.idInTest - 1];
  ({ adm: admision, caj: caja, enf: triaje, med: medico, jef: jefatura, sala, lectura })[st.role](st);
}
