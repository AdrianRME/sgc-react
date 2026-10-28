/**
 * Agenda de citas: horarios de los médicos, cupos libres y reglas para asignar una cita.
 * Lógica pura, sin React. La base de datos vuelve a validar cada cita en sgc_guardar().
 *
 * - Un horario es un bloque semanal de un médico:
 *   { id, med, dow (1 = lunes … 7 = domingo), ini: 'HH:MM', fin: 'HH:MM', area, on }.
 * - Cada bloque se divide en cupos de la duración de la especialidad del médico (ESPECIALIDADES.dur).
 * - Un cupo está tomado si una cita vigente (no cancelada ni sobrecupo) de ese médico empieza dentro de él.
 * - Así se sabe, por ejemplo, que si Cardiología solo atiende martes y jueves, al paciente que pasa por
 *   triaje un lunes le corresponde el primer cupo libre del martes.
 */
import { AREAS, CITA_DIAS_MAX, DAY, DIAS_SEMANA, ESPECIALIDADES, MIN } from './constants.js';
import { DomainError, turnKey } from './clinical.js';
import { ageAt, fmtHora, startOfDay } from './format.js';

export const especialidad = (k) => ESPECIALIDADES.find((e) => e.k === k);
/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export const isoDow = (t) => new Date(t).getDay() || 7;
export const diaNombre = (dow) => DIAS_SEMANA.find(([d]) => d === dow)?.[1] ?? '';
export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
export const fmtHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);

/** Instante de un día a cierta hora local (minutos desde la medianoche). */
const atMin = (day, min) => {
  const d = new Date(day);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d.getTime();
};
const minOfDay = (t) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};
/** Inicio del día que está `d` días después de `today` (robusto ante cambios de horario). */
const dayAfter = (today, d) => startOfDay(today + d * DAY + DAY / 2);

/* ---------- Médicos y horarios ---------- */

export const medicosDe = (users, k) => users.filter((u) => u.role === 'med' && u.on && u.esp === k);

/** Bloques activos de un médico (de un día de la semana, si se indica), en orden. */
export const horariosDe = (horarios, med, dow = null) =>
  horarios
    .filter((h) => h.on && h.med === med && (dow == null || h.dow === dow))
    .sort((a, b) => a.dow - b.dow || toMin(a.ini) - toMin(b.ini));

/** Cupos (inicio en ms) de un bloque de horario en un día. */
export function cuposDelBloque(h, day, dur) {
  const out = [];
  for (let m = toMin(h.ini); m + dur <= toMin(h.fin); m += dur) out.push(atMin(day, m));
  return out;
}

/** Días de la semana en que atiende una especialidad (con algún médico activo). */
export function diasDeAtencion(db, espK) {
  const meds = new Set(medicosDe(db.users, espK).map((u) => u.u));
  return [...new Set(db.horarios.filter((h) => h.on && meds.has(h.med)).map((h) => h.dow))].sort((a, b) => a - b);
}

/** «lunes, miércoles y viernes». */
export function listaDias(dows) {
  const n = dows.map((d) => diaNombre(d).toLowerCase());
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0] || 'ningún día';
}

/** Consultorio de un médico hoy: el del bloque en curso, o el siguiente, o el primero del día. */
export function consultorioHoy(horarios, med, now) {
  const hs = horariosDe(horarios, med, isoDow(now));
  const m = minOfDay(now);
  return (hs.find((h) => m >= toMin(h.ini) && m < toMin(h.fin)) || hs.find((h) => toMin(h.ini) > m) || hs[0])?.area ?? null;
}

/* ---------- Cupos ---------- */

/** Inicio de las citas vigentes de cada médico (las de `except`, que se reprograma, no cuentan). */
function ocupadas(turns, except) {
  const map = new Map();
  for (const t of turns) {
    if (!t.cita || t.cita.sobre || t.state === 'CANCELADO' || turnKey(t) === except) continue;
    if (!map.has(t.cita.med)) map.set(t.cita.med, []);
    map.get(t.cita.med).push(t.cita.at);
  }
  return map;
}
const tomado = (list, start, dur) => (list || []).some((x) => x >= start && x < start + dur * MIN);

/**
 * Cupos libres de una especialidad desde `now`, en orden de fecha y hora: [{ at, med, area, dur }].
 * Opciones: `med` (solo ese médico), `dias` (horizonte: 0 = solo hoy), `limit` y `except` (clave del
 * turno que se reprograma, para que su propio cupo cuente como libre).
 */
export function cuposLibres(db, espK, now, { med = null, dias = CITA_DIAS_MAX, limit = Infinity, except = null } = {}) {
  const e = especialidad(espK);
  if (!e) return [];
  const meds = medicosDe(db.users, espK).filter((u) => !med || u.u === med);
  const occ = ocupadas(db.turns, except);
  const today = startOfDay(now);
  const out = [];
  for (let d = 0; d <= dias && out.length < limit; d++) {
    const day = dayAfter(today, d);
    const dow = isoDow(day);
    const free = [];
    for (const u of meds) {
      for (const h of horariosDe(db.horarios, u.u, dow)) {
        for (const start of cuposDelBloque(h, day, e.dur)) {
          if (start > now && !tomado(occ.get(u.u), start, e.dur)) free.push({ at: start, med: u.u, area: h.area, dur: e.dur });
        }
      }
    }
    out.push(...free.sort((a, b) => a.at - b.at || a.med.localeCompare(b.med)));
  }
  return out.slice(0, limit);
}

/** Cupos agrupados por día: [{ day, cupos }]. */
export function porDia(cupos) {
  const days = new Map();
  cupos.forEach((c) => {
    const d = startOfDay(c.at);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(c);
  });
  return [...days].map(([day, list]) => ({ day, cupos: list }));
}

/**
 * Médicos que atienden hoy y aún no terminan su horario: primero los que están atendiendo en este
 * momento y, entre ellos, los de la especialidad pedida. Se usa para el sobrecupo de un paciente crítico.
 */
export function deTurnoHoy(db, now, espK) {
  const m = minOfDay(now);
  const rows = [];
  for (const h of db.horarios.filter((x) => x.on && x.dow === isoDow(now) && toMin(x.fin) > m)) {
    const u = db.users.find((x) => x.u === h.med && x.on && x.role === 'med');
    if (u) rows.push({ med: u.u, esp: u.esp, area: h.area, ini: h.ini, fin: h.fin, ahora: toMin(h.ini) <= m });
  }
  const rank = (r) => (r.ahora ? 0 : 2) + (r.esp === espK ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || toMin(a.ini) - toMin(b.ini));
}

/** Cita de sobrecupo con un médico de turno: empieza ahora o cuando él empiece a atender hoy. */
export const sobrecupo = (d, now) => ({ esp: d.esp, med: d.med, area: d.area, at: Math.max(now, atMin(startOfDay(now), toMin(d.ini))), sobre: true });

/* ---------- Reglas de asignación ---------- */

const CARDIO = /presi[oó]n|hipertensi|palpitaci|taquicardia|dolor (de|en el) pecho/i;

/**
 * Reglas de derivación por motivo de consulta, en orden: la primera que coincide decide la especialidad.
 * [especialidad, motivo, condición del paciente (edad en años, sexo)]
 */
const DERIVACION = [
  ['CRED', /crecimiento|desarrollo|control del? ni[ñn]o|vacuna/i, (a) => a < 5],
  ['ODO', /muela|diente|dental|enc[ií]as?|caries/i],
  ['PSI', /ansiedad|triste|des[aá]nimo|depresi|estr[eé]s|insomnio|dormir|angustia|p[aá]nico/i],
  ['NUT', /control de peso|sobrepeso|obesidad|dieta|desnutri|alimentaci[oó]n/i],
  ['OBS', /embaraz|gestan|prenatal/i, (a, s) => s !== 'M'],
  ['GIN', /planificaci[oó]n|anticoncep|flujo vaginal|menstrua|papanicolau/i, (a, s) => s !== 'M'],
];
const INTERNA = /glucosa|diabetes|colesterol/i;
const PREVENTIVA = /chequeo|preventiv|salud familiar/i;

/**
 * Especialidad que propone el sistema: los motivos propios de un servicio (CRED, dental, salud mental, nutrición,
 * control prenatal, planificación familiar) van a ese servicio; los niños, a Pediatría; los motivos
 * cardiovasculares, a Cardiología; los crónicos metabólicos, a Medicina Interna; los chequeos, a Medicina Familiar;
 * lo demás, a Medicina General.
 */
export function especialidadSugerida(patient, tri, now = Date.now()) {
  const motivo = tri?.motivo || '';
  const edad = patient ? ageAt(patient.nac, now) : 30;
  const regla = DERIVACION.find(([, re, ok]) => re.test(motivo) && (!ok || ok(edad, patient?.sexo)));
  if (regla) return regla[0];
  if (edad < 12) return 'PED';
  if (CARDIO.test(motivo)) return 'CAR';
  if (INTERNA.test(motivo)) return 'MI';
  if (PREVENTIVA.test(motivo)) return 'MF';
  return 'MG';
}

/**
 * Cita que propone el sistema según la prioridad de triaje. Devuelve { cita, motivo } o null.
 * - CRÍTICA: sobrecupo hoy con el médico que está atendiendo (de preferencia, de la especialidad).
 * - PRIORITARIA: primer cupo de hoy en la especialidad; si hoy no atiende o no tiene cupo, primer cupo de
 *   hoy en Medicina General; si tampoco hay, el primer cupo disponible de la especialidad.
 * - NORMAL: primer cupo disponible de la especialidad, el día que sea.
 */
export function sugerirCita(db, espK, prio, now, except = null) {
  if (prio === 'CRITICA') {
    const d = deTurnoHoy(db, now, espK)[0];
    return d ? { cita: sobrecupo(d, now), motivo: 'sobrecupo' } : null;
  }
  const first = (k, dias) => {
    const c = cuposLibres(db, k, now, { dias, limit: 1, except })[0];
    return c && { esp: k, med: c.med, area: c.area, at: c.at, sobre: false };
  };
  if (prio === 'PRIORITARIA') {
    const hoy = first(espK, 0);
    if (hoy) return { cita: hoy, motivo: 'hoy' };
    const mg = espK !== 'MG' && first('MG', 0);
    if (mg) return { cita: mg, motivo: 'mg-hoy' };
  }
  const c = first(espK);
  return c ? { cita: c, motivo: sameDay(c.at, now) ? 'hoy' : 'otro-dia' } : null;
}

/**
 * Comprueba una cita antes de guardarla (la base de datos repite estas reglas). Devuelve el consultorio.
 * - El médico está activo y es de la especialidad, y atiende ese día de la semana.
 * - La fecha está entre hoy y CITA_DIAS_MAX días; un paciente crítico se atiende hoy.
 * - Cita normal: empieza justo en un cupo de su horario, todavía no pasó y nadie más lo tiene.
 * - Sobrecupo: solo para prioridad crítica, solo hoy y con un médico que aún no termina su horario.
 */
export function validarCita(db, c, { now, prio, except = null }) {
  const e = especialidad(c.esp);
  if (!e) throw new DomainError('Elija la especialidad.');
  const u = db.users.find((x) => x.u === c.med);
  if (!u || u.role !== 'med' || !u.on) throw new DomainError('El médico elegido no está activo.');
  if (u.esp !== c.esp) throw new DomainError(`${u.n} no atiende ${e.n}.`);
  const today = startOfDay(now);
  if (!(c.at >= today) || c.at >= dayAfter(today, CITA_DIAS_MAX + 1)) {
    throw new DomainError(`La cita debe ser entre hoy y los próximos ${CITA_DIAS_MAX} días.`);
  }
  const hs = horariosDe(db.horarios, u.u, isoDow(c.at));
  if (!hs.length) throw new DomainError(`${u.n} no atiende los ${diaNombre(isoDow(c.at)).toLowerCase()}.`);
  if (prio === 'CRITICA' && !sameDay(c.at, now)) {
    throw new DomainError('Prioridad crítica: el paciente debe atenderse hoy. Use el sobrecupo.');
  }
  const m = minOfDay(c.at);
  if (c.sobre) {
    if (prio !== 'CRITICA') throw new DomainError('El sobrecupo es solo para pacientes con prioridad crítica.');
    const h = hs.find((x) => toMin(x.fin) > minOfDay(now));
    if (!h) throw new DomainError(`${u.n} ya terminó su horario de hoy.`);
    return { area: (hs.find((x) => m >= toMin(x.ini) && m < toMin(x.fin)) || h).area };
  }
  const h = c.at % MIN === 0 && hs.find((x) => m >= toMin(x.ini) && m + e.dur <= toMin(x.fin) && (m - toMin(x.ini)) % e.dur === 0);
  if (!h) throw new DomainError(`Las ${fmtHora(c.at)} no es un cupo del horario de ${u.n}.`);
  if (c.at <= now) throw new DomainError('Ese cupo ya pasó. Elija otro.');
  if (tomado(ocupadas(db.turns, except).get(u.u), c.at, e.dur)) throw new DomainError('Ese cupo ya fue tomado. Elija otro.');
  return { area: h.area };
}

/** Citas de un día (de un médico, si se indica), en orden de hora. */
export const citasDelDia = (turns, day, med = null) =>
  turns.filter((t) => t.cita && sameDay(t.cita.at, day) && (!med || t.cita.med === med)).sort((a, b) => a.cita.at - b.cita.at);

/* ---------- Horarios (Jefatura) ---------- */

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const overlap = (a, b) => toMin(a.ini) < toMin(b.fin) && toMin(b.ini) < toMin(a.fin);

/** Citas por atender (de hoy en adelante) que caen dentro de un bloque de horario. */
export function citasEnBloque(db, h, now) {
  return db.turns.filter((t) => t.cita && t.cita.med === h.med && !['ATENDIDO', 'CANCELADO'].includes(t.state)
    && t.cita.at >= startOfDay(now) && isoDow(t.cita.at) === h.dow
    && minOfDay(t.cita.at) >= toMin(h.ini) && minOfDay(t.cita.at) < toMin(h.fin));
}

/**
 * Reglas de un bloque de horario: médico activo, hora válida entre 06:00 y 22:00, al menos un cupo,
 * sin cruzarse con otro bloque del mismo médico ni con otro médico en el mismo consultorio.
 */
export function validarHorario(db, h) {
  const u = db.users.find((x) => x.u === h.med);
  if (!u || u.role !== 'med' || !u.on) throw new DomainError('Elija un médico activo.');
  const e = especialidad(u.esp);
  if (!e) throw new DomainError(`${u.n} no tiene especialidad registrada.`);
  if (!DIAS_SEMANA.some(([d]) => d === h.dow)) throw new DomainError('Elija el día de la semana.');
  if (!HM.test(h.ini) || !HM.test(h.fin)) throw new DomainError('Indique la hora de inicio y de fin (HH:MM).');
  if (toMin(h.ini) < 6 * 60 || toMin(h.fin) > 22 * 60) throw new DomainError('El horario debe estar entre las 06:00 y las 22:00.');
  if (toMin(h.fin) - toMin(h.ini) < e.dur) throw new DomainError(`El bloque debe durar al menos una cita de ${e.n} (${e.dur} min).`);
  if (!AREAS.includes(h.area)) throw new DomainError('Elija el consultorio.');
  const others = db.horarios.filter((x) => x.on && x.id !== h.id && x.dow === h.dow);
  const mine = others.find((x) => x.med === h.med && overlap(x, h));
  if (mine) throw new DomainError(`${u.n} ya atiende ese día de ${mine.ini} a ${mine.fin}.`);
  const room = others.find((x) => x.med !== h.med && x.area === h.area && overlap(x, h));
  if (room) {
    const o = db.users.find((x) => x.u === room.med);
    throw new DomainError(`${h.area} está asignado a ${o?.n ?? room.med} ese día de ${room.ini} a ${room.fin}.`);
  }
  return { cupos: Math.floor((toMin(h.fin) - toMin(h.ini)) / e.dur), esp: e };
}

/** La agenda pública de una especialidad (sgc_cupos) como una base mínima, para calcular sus cupos libres. */
export const agendaPublica = (c) => ({
  users: c.users, horarios: c.horarios, turns: c.ocupadas.map((o) => ({ state: 'CITADO', cita: { ...o, sobre: false } })),
});
