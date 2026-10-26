/**
 * Reglas de negocio del sistema. Cada acción es una función pura:
 *   (db, ctx, ...args) => { changes, toast?, result? }
 * - db: { patients, turns, users, audit, thresholds, horarios }
 * - ctx: { user, area, now, ip }
 * - changes: registros a insertar/actualizar por tabla (el repositorio los persiste).
 * Si una regla no se cumple se lanza DomainError con un mensaje para el usuario.
 */
import {
  DomainError, assertTransition, evalTriage, validateVitals, validateThresholds,
  allergyConflicts, validatePrescription, isCurrent, latestThresholds, turnKey,
} from '../lib/clinical.js';
import {
  ACTIVE_STATES, TRIAGE_STATION, ROLES, PRIO, TARIFA_CONSULTA, METODOS_PAGO, SIS_EXONERADO, ESPECIALIDADES,
} from '../lib/constants.js';
import { nextTurnId, nextRecipe, nextHC, nextComprobante, uid, tempPassword } from '../lib/ids.js';
import { maskDni, fullName, age, fmtD, fmtHora, fmtLongDay } from '../lib/format.js';
import { citasEnBloque, especialidad, sameDay, validarCita, validarHorario } from '../lib/agenda.js';

export const currentThresholds = (db) => latestThresholds(db.thresholds)?.vals;

const auditEntry = (ctx, a, d) => ({ id: uid(), t: ctx.now, u: ctx.user?.u ?? '-', a, d, ip: ctx.ip });

/** El código se reinicia cada día: se busca entre los turnos de hoy y los que siguen abiertos. */
const findTurn = (db, id, now) => {
  const t = db.turns.find((x) => x.id === id && isCurrent(x, now));
  if (!t) throw new DomainError(`No se encontró el turno ${id}.`);
  return t;
};

/* ---------- Sesión ---------- */

export function loginAudit(db, ctx) {
  return { changes: { audit: [auditEntry(ctx, 'LOGIN', `Inicio de sesión de ${ctx.user.u}`)] } };
}

export function logoutAudit(db, ctx) {
  return { changes: { audit: [auditEntry(ctx, 'LOGOUT', `Cierre de sesión de ${ctx.user.u}`)] } };
}

export function changeArea(db, ctx, area) {
  const busy = db.turns.find((t) => t.state === 'EN_CONSULTA' && t.med === ctx.user.u);
  if (busy) throw new DomainError(`Termine o devuelva la atención de ${busy.id} antes de cambiar de consultorio.`);
  return { changes: { audit: [auditEntry(ctx, 'AREA', `${ctx.user.u} en ${area}`)] }, result: area };
}

/* ---------- Admisión ---------- */

export function searchAudit(db, ctx, dni) {
  return { changes: { audit: [auditEntry(ctx, 'BUSQUEDA_DNI', `DNI ${maskDni(dni)}`)] } };
}

export const activeTurnOf = (db, dni) =>
  db.turns.find((t) => t.dni === dni && ACTIVE_STATES.includes(t.state));

export function validatePatientForm(f) {
  const e = {};
  if (!f.nom?.trim()) e.nom = 'Obligatorio';
  if (!f.ape?.trim()) e.ape = 'Obligatorio';
  if (!f.nac) e.nac = 'Obligatorio';
  else {
    const a = age(f.nac);
    if (new Date(f.nac) > new Date()) e.nac = 'La fecha no puede ser futura';
    else if (a > 120) e.nac = 'Revise la fecha';
  }
  if (f.tel && !/^[0-9 +]{6,15}$/.test(f.tel.trim())) e.tel = 'Solo números (6 a 15 dígitos)';
  return e;
}

export function createTurn(db, ctx, { dni, form, sis }) {
  if (!/^\d{8}$/.test(dni)) throw new DomainError('El DNI debe tener 8 dígitos.');
  const dup = activeTurnOf(db, dni);
  if (dup) throw new DomainError(`El paciente ya tiene el turno ${dup.id} activo.`);

  const audit = [];
  let patient = db.patients.find((p) => p.dni === dni);
  if (!patient) {
    const errs = validatePatientForm(form);
    if (Object.keys(errs).length) throw new DomainError('Complete correctamente los datos del paciente.');
    patient = {
      dni, nom: form.nom.trim(), ape: form.ape.trim(), nac: form.nac, sexo: form.sexo,
      tel: form.tel?.trim() || '', sis, hc: nextHC(db.patients), ant: '', alg: '',
    };
    audit.push(auditEntry(ctx, 'PACIENTE_NUEVO', `${patient.hc} creada`));
  } else {
    patient = { ...patient, tel: form.tel?.trim() ?? patient.tel, sis };
  }

  // Con SIS la consulta no se cobra: se registra un pago de S/ 0.00 y el paciente pasa directo a triaje.
  // Sin seguro, el turno espera en Caja: no entra a triaje hasta pagar.
  const id = nextTurnId(db.turns, ctx.now);
  const exonerado = SIS_EXONERADO.includes(sis);
  const turn = {
    id, dni, adm: ctx.user.u, state: exonerado ? 'EN_ESPERA_TRIAJE' : 'PENDIENTE_PAGO', prio: null, t0: ctx.now,
    ...(exonerado && { tPago: ctx.now, pago: { metodo: 'SIS', monto: 0, comp: null, by: ctx.user.u, t: ctx.now } }),
  };
  audit.push(auditEntry(ctx, 'TURNO_CREADO', `${id} registrado${sis === 'PENDIENTE_VALIDACION' ? ' (contingencia SIS)' : ''}`));
  if (exonerado) audit.push(auditEntry(ctx, 'PAGO_REGISTRADO', `${id} exonerado por SIS`));
  return {
    changes: { patients: [patient], turns: [turn], audit },
    toast: ['ok', exonerado
      ? `Turno ${id} generado para ${fullName(patient)}. Con SIS no paga: pasa directo a triaje.`
      : `Turno ${id} generado para ${fullName(patient)}. Debe pagar S/ ${TARIFA_CONSULTA.toFixed(2)} en Caja antes del triaje.`],
    result: turn,
  };
}

/* ---------- Caja ---------- */

/**
 * Cobro de la consulta: emite la boleta y libera al paciente para triaje.
 * En efectivo, el monto recibido debe cubrir la tarifa (el vuelto se calcula en pantalla).
 */
export function registerPayment(db, ctx, id, { metodo, recibido }) {
  const t = findTurn(db, id, ctx.now);
  if (t.state !== 'PENDIENTE_PAGO') throw new DomainError(`El turno ${id} no tiene un pago pendiente.`);
  assertTransition(t, 'EN_ESPERA_TRIAJE');
  if (!METODOS_PAGO[metodo] || metodo === 'SIS') throw new DomainError('Elija el medio de pago: efectivo, tarjeta o billetera digital.');
  if (metodo === 'EFECTIVO' && !(+recibido >= TARIFA_CONSULTA)) {
    throw new DomainError(`El monto recibido no cubre la tarifa de S/ ${TARIFA_CONSULTA.toFixed(2)}.`);
  }
  const comp = nextComprobante(db.turns, db.meta?.compMax);
  const pago = { metodo, monto: TARIFA_CONSULTA, comp, by: ctx.user.u, t: ctx.now };
  const turn = { ...t, state: 'EN_ESPERA_TRIAJE', tPago: ctx.now, pago };
  return {
    changes: {
      turns: [turn],
      audit: [auditEntry(ctx, 'PAGO_REGISTRADO', `${id} · ${comp} · S/ ${TARIFA_CONSULTA.toFixed(2)} · ${METODOS_PAGO[metodo]}`)],
    },
    toast: ['ok', `Pago registrado (${comp}). ${id} pasa a la lista de triaje.`],
    result: turn,
  };
}

export function cancelTurn(db, ctx, id, motivo) {
  const t = findTurn(db, id, ctx.now);
  assertTransition(t, 'CANCELADO');
  const turn = { ...t, state: 'CANCELADO', cancel: { motivo, by: ctx.user.u, t: ctx.now } };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'TURNO_CANCELADO', `${id} · ${motivo}`)] },
    toast: ['info', `Turno ${id} cerrado: ${motivo.toLowerCase()}.`],
  };
}

/* ---------- Llamado ---------- */

export function callTurn(db, ctx, id) {
  const t = findTurn(db, id, ctx.now);
  const tri = t.state === 'EN_ESPERA_TRIAJE' || t.state === 'LLAMADO_TRIAJE';
  const to = tri ? 'LLAMADO_TRIAJE' : 'LLAMADO_CONSULTA';
  assertTransition(t, to);
  if (!tri && t.cita && t.cita.med !== ctx.user.u) {
    throw new DomainError(`${id} tiene cita con ${medName(db, t.cita.med)}: solo su médico puede llamarlo.`);
  }
  if (!tri && t.state === 'LLAMADO_CONSULTA' && t.dest !== ctx.area) {
    throw new DomainError(`${id} ya fue llamado a ${t.dest}.`);
  }
  // CR-06: no se llama a otro paciente mientras el consultorio tiene una atención abierta
  const open = !tri && db.turns.find((x) => x.state === 'EN_CONSULTA' && x.dest === ctx.area && x.id !== id);
  if (open) throw new DomainError(`Termine o devuelva la atención de ${open.id} antes de llamar a otro paciente.`);
  const dest = tri ? TRIAGE_STATION : ctx.area;
  const repeat = t.state === to;
  const turn = {
    ...t, state: to, dest, calledAt: ctx.now, calls: (t.calls || 0) + 1,
    ...(tri ? { tTriCall: t.tTriCall || ctx.now } : { tMedCall: t.tMedCall || ctx.now }),
  };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'LLAMADO', `${id} → ${dest}${repeat ? ' (repetido)' : ''}`)] },
    toast: ['ok', `${repeat ? 'Llamado repetido' : 'Llamando'}: ${id} → ${dest}. Se muestra en la pantalla de sala.`],
  };
}

export function callNext(db, ctx, queue, sorter) {
  const waiting = queue === 'tri' ? 'EN_ESPERA_TRIAJE' : 'EN_ESPERA_CONSULTA';
  // En consulta, cada médico llama solo a los pacientes que tienen cita con él
  const mine = (t) => queue === 'tri' || !t.cita || t.cita.med === ctx.user.u;
  const next = db.turns.filter((t) => t.state === waiting && mine(t)).sort(sorter)[0];
  if (!next) throw new DomainError('No hay pacientes en espera.');
  return callTurn(db, ctx, next.id);
}

/* ---------- Triaje ---------- */

export function startTriage(db, ctx, id) {
  const t = findTurn(db, id, ctx.now);
  assertTransition(t, 'EN_TRIAJE');
  const busy = db.turns.find((x) => x.state === 'EN_TRIAJE' && x.id !== id);
  if (busy) throw new DomainError(`Ya hay un paciente en triaje (${busy.id}). Finalícelo o devuélvalo a la lista.`);
  return { changes: { turns: [{ ...t, state: 'EN_TRIAJE', enf: ctx.user.u }] } };
}

export function returnToQueue(db, ctx, id) {
  const t = findTurn(db, id, ctx.now);
  const to = t.state === 'EN_TRIAJE' ? 'EN_ESPERA_TRIAJE' : 'EN_ESPERA_CONSULTA';
  assertTransition(t, to);
  const turn = { ...t, state: to, calledAt: null };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'DEVUELTO', `${id} vuelve a la lista (${to === 'EN_ESPERA_TRIAJE' ? 'triaje' : 'consulta'})`)] },
    toast: ['info', `${id} volvió a la lista conservando su lugar.`],
  };
}

export function saveTriage(db, ctx, id, vitals, allergies) {
  const t = findTurn(db, id, ctx.now);
  assertTransition(t, t.cita && sameDay(t.cita.at, ctx.now) ? 'EN_ESPERA_CONSULTA' : 'PENDIENTE_CITA');
  const errs = validateVitals(vitals);
  if (Object.keys(errs).length) throw new DomainError('Revise los signos vitales marcados.');
  const tri = {
    pa: vitals.pa.trim(), fc: +vitals.fc, fr: +vitals.fr, t: +vitals.t, spo2: +vitals.spo2,
    peso: +vitals.peso, talla: +vitals.talla, motivo: vitals.motivo.trim(),
  };
  const r = evalTriage(tri, currentThresholds(db));
  // Quien reservó su cita para hoy ya la tiene: del triaje pasa directo a la espera de su médico
  const conCita = t.cita && sameDay(t.cita.at, ctx.now);
  const turn = {
    ...t, tri, prio: r.prio, state: conCita ? 'EN_ESPERA_CONSULTA' : 'PENDIENTE_CITA', tTriSave: ctx.now, enf: ctx.user.u, calledAt: null,
    ...(conCita && { llego: ctx.now, tLlega: Math.max(ctx.now, t.cita.at) }),
  };
  const changes = { turns: [turn], audit: [auditEntry(ctx, 'TRIAJE_GUARDADO', `${id} prioridad ${r.prio}`)] };
  const p = db.patients.find((x) => x.dni === t.dni);
  if (p && (allergies ?? '').trim() !== (p.alg ?? '')) {
    changes.patients = [{ ...p, alg: allergies.trim() }];
    changes.audit.push(auditEntry(ctx, 'ALERGIAS', `${p.hc} alergias actualizadas`));
  }
  return {
    changes,
    toast: [r.prio === 'CRITICA' ? 'crit' : 'ok',
      `Triaje de ${id} guardado · prioridad ${PRIO[r.prio][0].toUpperCase()}. ${conCita
        ? `Ya tiene cita a las ${fmtHora(t.cita.at)} con ${medName(db, t.cita.med)}: pasa a la espera de su médico.`
        : r.prio === 'CRITICA' ? 'Asígnele ahora un sobrecupo para hoy.' : 'Asígnele ahora su cita: no necesita volver a Admisión.'}`],
    result: turn,
  };
}

/* ---------- Citas ---------- */

const medName = (db, u) => db.users.find((x) => x.u === u)?.n ?? u;
const citaText = (db, c) => `${especialidad(c.esp)?.n} con ${medName(db, c.med)}, ${fmtD(c.at)} ${fmtHora(c.at)}${c.sobre ? ' (sobrecupo)' : ''}`;

/**
 * Asigna o reprograma la cita de un paciente que ya pasó por triaje. El sistema valida que el médico
 * atienda ese día y a esa hora (su horario), que el cupo esté libre y las reglas de prioridad.
 * - Paciente recién salido de triaje con cita para hoy: pasa a la espera de consulta.
 * - Cita otro día (o reprogramación): el turno queda CITADO hasta que vuelva y se registre su llegada.
 */
export function assignCita(db, ctx, id, { esp, med, at, sobre = false }) {
  const t = findTurn(db, id, ctx.now);
  if (!['PENDIENTE_CITA', 'CITADO'].includes(t.state)) throw new DomainError(`El turno ${id} no está esperando una cita.`);
  const c = { esp, med, at: +at, sobre: !!sobre };
  const { area } = validarCita(db, c, { now: ctx.now, prio: t.prio, except: turnKey(t) });
  const presente = t.state === 'PENDIENTE_CITA' && sameDay(c.at, ctx.now);
  const to = presente ? 'EN_ESPERA_CONSULTA' : 'CITADO';
  assertTransition(t, to);
  const reprog = t.state === 'CITADO';
  const cita = { ...c, area, by: ctx.user.u, t: t.cita?.t ?? ctx.now };
  const { tLlega: _l, llego: _g, ...base } = t;
  const turn = {
    ...base, state: to, cita, tCita: t.tCita ?? ctx.now,
    ...(presente && { llego: ctx.now, tLlega: Math.max(ctx.now, c.at) }),
  };
  return {
    changes: {
      turns: [turn],
      audit: [auditEntry(ctx, reprog ? 'CITA_REPROGRAMADA' : 'CITA_ASIGNADA', `${id} → ${citaText(db, cita)}`)],
    },
    toast: ['ok', presente
      ? `Cita para hoy a las ${fmtHora(c.at)} con ${medName(db, med)} (${area}). ${id} pasa a la sala de espera de consulta.`
      : `Cita ${reprog ? 'reprogramada' : 'programada'} para el ${fmtLongDay(c.at)} a las ${fmtHora(c.at)} con ${medName(db, med)}. El paciente vuelve ese día.`],
    result: turn,
  };
}

/**
 * Llegada de un paciente citado: solo el día de su cita. Pasa a la espera de consulta de su médico; su
 * espera cuenta desde la hora de la cita (si llegó antes) o desde que llegó (si llegó tarde).
 */
export function checkIn(db, ctx, id) {
  const t = findTurn(db, id, ctx.now);
  if (t.state !== 'CITADO') throw new DomainError(`El turno ${id} no tiene una cita pendiente.`);
  if (!sameDay(t.cita.at, ctx.now)) {
    throw new DomainError(t.cita.at < ctx.now
      ? `La cita de ${id} fue el ${fmtD(t.cita.at)} y venció. Reprográmela o márquela como no asistida.`
      : `La cita de ${id} es el ${fmtLongDay(t.cita.at)}. La llegada se registra el mismo día de la cita.`);
  }
  if (!t.tTriSave) {
    // Reservó su cita por web o por teléfono: todavía no pasó por Caja ni por triaje. Su llegada real es ahora.
    const p = db.patients.find((x) => x.dni === t.dni);
    const exonerado = SIS_EXONERADO.includes(p?.sis);
    const to = exonerado ? 'EN_ESPERA_TRIAJE' : 'PENDIENTE_PAGO';
    assertTransition(t, to);
    const turn = {
      ...t, _prev: turnKey(t), state: to, t0: ctx.now,
      ...(exonerado && { tPago: ctx.now, pago: { metodo: 'SIS', monto: 0, comp: null, by: ctx.user.u, t: ctx.now } }),
    };
    return {
      changes: { turns: [turn], audit: [auditEntry(ctx, 'LLEGADA_CITA', `${id} llegó a su cita reservada de las ${fmtHora(t.cita.at)}`)] },
      toast: ['ok', exonerado
        ? `Llegada registrada. ${id} tiene SIS: pasa a triaje y luego a su cita de las ${fmtHora(t.cita.at)}.`
        : `Llegada registrada. ${id} paga primero en Caja, pasa a triaje y luego a su cita de las ${fmtHora(t.cita.at)}.`],
      result: { ...turn, _prev: undefined },
    };
  }
  assertTransition(t, 'EN_ESPERA_CONSULTA');
  const turn = { ...t, state: 'EN_ESPERA_CONSULTA', llego: ctx.now, tLlega: Math.max(ctx.now, t.cita.at) };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'LLEGADA_CITA', `${id} llegó a su cita de las ${fmtHora(t.cita.at)}`)] },
    toast: ['ok', `Llegada registrada. ${id} espera en sala: cita de las ${fmtHora(t.cita.at)} con ${medName(db, t.cita.med)} (${t.cita.area}).`],
    result: turn,
  };
}

/* ---------- Cita por web o por teléfono ---------- */

/** Paciente con historia que coincide con DNI y fecha de nacimiento (o null). */
export const pacienteVerificado = (db, dni, nac) =>
  db.patients.find((p) => p.dni === String(dni).trim() && p.nac === nac) ?? null;

/** Cita o turno activo de un paciente, con el nombre del médico (lo que ve el paciente al identificarse). */
export function citaActivaDe(db, dni) {
  const t = activeTurnOf(db, dni);
  if (!t) return null;
  return { id: t.id, state: t.state, cita: t.cita ? { ...t.cita, medico: medName(db, t.cita.med) } : null };
}

/**
 * Reserva de cita por web (el propio paciente) o por teléfono (Admisión). Requiere DNI y fecha de nacimiento
 * de un paciente con historia y que no tenga otra cita o turno activo. Sin triaje no hay prioridad: la cita es
 * un cupo normal del horario del médico. El día de la cita el paciente registra su llegada en Admisión.
 */
export function reservarCita(db, ctx, { dni, nac, cita, canal }) {
  const p = pacienteVerificado(db, dni, nac);
  if (!p) throw new DomainError('No encontramos un paciente con ese DNI y esa fecha de nacimiento.');
  const act = activeTurnOf(db, p.dni);
  if (act) {
    throw new DomainError(`Ya tiene ${act.state === 'CITADO' ? 'una cita pendiente' : 'un turno activo'} (${act.id}). Solo puede tener una a la vez: espere a ser atendido o pida en Admisión que la anulen.`);
  }
  const c = { esp: cita.esp, med: cita.med, at: +cita.at, sobre: false };
  const { area } = validarCita(db, c, { now: ctx.now, prio: 'NORMAL' });
  const id = nextTurnId(db.turns, ctx.now);
  const turn = {
    id, dni: p.dni, adm: ctx.user.u, state: 'CITADO', prio: null, t0: ctx.now, tCita: ctx.now,
    cita: { ...c, area, by: ctx.user.u, t: ctx.now },
  };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'CITA_WEB', `${id} reservó su cita por ${canal}`)] },
    toast: ['ok', `Cita reservada: ${citaText(db, turn.cita)}.`],
    result: turn,
  };
}

/* ---------- Consulta ---------- */

export function startConsult(db, ctx, id) {
  const t = findTurn(db, id, ctx.now);
  assertTransition(t, 'EN_CONSULTA');
  if (t.dest !== ctx.area) throw new DomainError(`${id} fue llamado a ${t.dest}, no a ${ctx.area}.`);
  const busy = db.turns.find((x) => x.state === 'EN_CONSULTA' && x.dest === ctx.area);
  if (busy) throw new DomainError(`${ctx.area} ya está atendiendo a ${busy.id}.`);
  const p = db.patients.find((x) => x.dni === t.dni);
  return {
    changes: {
      turns: [{ ...t, state: 'EN_CONSULTA', med: ctx.user.u }],
      audit: [auditEntry(ctx, 'HC_CONSULTADA', `${p?.hc} abierta en consulta`)],
    },
  };
}

export function finishConsult(db, ctx, id, { notas, dx, meds, dest, destx, allergyOverride }) {
  const t = findTurn(db, id, ctx.now);
  assertTransition(t, 'ATENDIDO');
  if (!notas?.trim()) throw new DomainError('Registre la anamnesis y el examen clínico.');
  if (!dx.length) throw new DomainError('Seleccione al menos un diagnóstico CIE-10.');
  const list = meds.filter((m) => m.n.trim());
  const perr = validatePrescription(list);
  if (perr.length) throw new DomainError(perr[0]);
  if (dest === 'Reposo médico' && !(+destx >= 1 && +destx <= 30)) throw new DomainError('Indique los días de reposo (1 a 30).');
  if (dest === 'Derivación a hospital' && !destx?.trim()) throw new DomainError('Indique el establecimiento de destino.');

  const p = db.patients.find((x) => x.dni === t.dni);
  const conflicts = allergyConflicts(p?.alg, list.map((m) => m.n));
  if (conflicts.length && !allergyOverride) {
    throw new DomainError(`Alergia registrada (${p.alg}): revise ${conflicts.map((c) => c.med).join(', ')} o confirme la prescripción.`);
  }

  const rec = nextRecipe(db.turns, new Date(ctx.now).getFullYear(), db.meta?.recMax);
  const consult = {
    notas: notas.trim(), dx, meds: list.map((m) => ({ ...m, dias: +m.dias })), dest, destx: destx?.trim() || '',
    rec, t: ctx.now, area: ctx.area, medico: { u: ctx.user.u, n: ctx.user.n, col: ctx.user.col },
  };
  const audit = [auditEntry(ctx, 'ATENCION_FINALIZADA', `${id} · ${rec} · ${dest}`)];
  // Sin nombres de medicamentos: la auditoría la lee Jefatura, que no accede a recetas
  if (conflicts.length) audit.push(auditEntry(ctx, 'ALERGIA_CONFIRMADA', `${id}: prescripción confirmada pese a alergia registrada`));
  return {
    changes: { turns: [{ ...t, state: 'ATENDIDO', tEnd: ctx.now, consult, calledAt: null }], audit },
    toast: ['ok', `Atención finalizada (${dest}). Receta ${rec} emitida; ${ctx.area} queda libre.`],
    result: id,
  };
}

/* ---------- Jefatura ---------- */

export function createUser(db, ctx, f) {
  const u = f.u.trim().toLowerCase();
  if (!/^[a-z0-9._]{4,20}$/.test(u)) throw new DomainError('El usuario debe tener de 4 a 20 caracteres (letras, números, punto o guion bajo).');
  if (db.users.some((x) => x.u === u)) throw new DomainError('Ese usuario ya existe.');
  if (!f.n.trim()) throw new DomainError('Ingrese el nombre completo.');
  if (!ROLES[f.role]) throw new DomainError('Rol no válido.');
  const { prefix } = ROLES[f.role];
  if (!u.startsWith(prefix) || u.length <= prefix.length) {
    throw new DomainError(`El usuario de ${ROLES[f.role].n} empieza con «${prefix}», por ejemplo ${prefix}apellido.`);
  }
  if (f.role === 'med' && !/^CMP-\d{5}$/.test(f.col.trim())) throw new DomainError('La colegiatura del médico debe tener el formato CMP-00000.');
  if (f.role === 'enf' && f.col.trim() && !/^CEP-\d{5}$/.test(f.col.trim())) throw new DomainError('La colegiatura de enfermería debe tener el formato CEP-00000.');
  if (f.role === 'med' && !ESPECIALIDADES.some((e) => e.k === f.esp)) throw new DomainError('Elija la especialidad del médico.');
  const clave = tempPassword();
  const user = {
    u, n: f.n.trim(), role: f.role, col: f.col.trim(), on: true, clave_temporal: clave, ...(f.role === 'med' && { esp: f.esp }),
  };
  return {
    changes: { users: [user], audit: [auditEntry(ctx, 'USUARIO', `${u} creado (${ROLES[f.role].n})`)] },
    result: { u, clave },
  };
}

export function toggleUser(db, ctx, u) {
  if (u === ctx.user.u) throw new DomainError('No puede desactivar su propio usuario.');
  const x = db.users.find((y) => y.u === u);
  const user = { ...x, on: !x.on };
  if (!user.on && x.role === 'jef' && db.users.filter((y) => y.role === 'jef' && y.on).length <= 1) {
    throw new DomainError('Debe quedar al menos un usuario de Jefatura activo.');
  }
  return {
    changes: { users: [user], audit: [auditEntry(ctx, 'USUARIO', `${u} ${user.on ? 'activado' : 'desactivado'}`)] },
    toast: ['info', `Usuario ${u} ${user.on ? 'activado' : 'desactivado'}.`],
  };
}

export function resetPassword(db, ctx, u) {
  const x = db.users.find((y) => y.u === u);
  if (!x) throw new DomainError('Usuario no encontrado.');
  const clave = tempPassword();
  return {
    changes: { users: [{ ...x, clave_temporal: clave }], audit: [auditEntry(ctx, 'RESET_CLAVE', `Clave temporal para ${u}`)] },
    result: { u, clave },
  };
}

/* ---------- Horarios (Jefatura) ---------- */

/** Agrega un bloque al horario semanal de un médico. Con él, el sistema calcula los cupos de cita. */
export function saveHorario(db, ctx, h) {
  const row = { id: h.id || uid(), med: h.med, dow: +h.dow, ini: h.ini, fin: h.fin, area: h.area, on: true };
  const { cupos, esp } = validarHorario(db, row);
  return {
    changes: { horarios: [row], audit: [auditEntry(ctx, 'HORARIO', `Horario agregado: ${medName(db, row.med)}, día ${row.dow}, ${row.ini}-${row.fin}, ${row.area}`)] },
    toast: ['ok', `Horario guardado: ${cupos} cupos de ${esp.n} ese día.`],
  };
}

/** Quita un bloque del horario. No se puede si tiene citas por atender: primero hay que reprogramarlas. */
export function removeHorario(db, ctx, id) {
  const h = db.horarios.find((x) => x.id === id);
  if (!h || !h.on) throw new DomainError('El bloque de horario ya no existe.');
  const pend = citasEnBloque(db, h, ctx.now);
  if (pend.length) {
    throw new DomainError(`Hay ${pend.length} cita${pend.length > 1 ? 's' : ''} por atender en este horario (${pend.map((t) => t.id).join(', ')}). Reprográmelas antes de quitarlo.`);
  }
  return {
    changes: { horarios: [{ ...h, on: false }], audit: [auditEntry(ctx, 'HORARIO', `Horario retirado: ${medName(db, h.med)}, día ${h.dow}, ${h.ini}-${h.fin}`)] },
    toast: ['info', 'Bloque de horario retirado.'],
  };
}

export function saveThresholds(db, ctx, vals, by) {
  const errs = validateThresholds(vals);
  if (errs.length) throw new DomainError(errs[0]);
  if (!by?.trim()) throw new DomainError('Indique el médico responsable que aprueba los umbrales.');
  if (!db.users.some((x) => x.role === 'med' && x.on && x.n === by.trim())) throw new DomainError('El aprobador debe ser un médico activo registrado.');
  const row = { id: uid(), vals, by: by.trim(), since: ctx.now };
  return {
    changes: { thresholds: [row], audit: [auditEntry(ctx, 'UMBRALES', `Umbrales aprobados por ${row.by}`)] },
    toast: ['ok', 'Umbrales guardados. La versión anterior queda en el historial.'],
  };
}
