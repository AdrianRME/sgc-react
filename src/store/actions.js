/**
 * Reglas de negocio del sistema. Cada acción es una función pura:
 *   (db, ctx, ...args) => { changes, toast?, result? }
 * - db: { patients, turns, users, audit, thresholds }
 * - ctx: { user, area, now, ip }
 * - changes: registros a insertar/actualizar por tabla (el repositorio los persiste).
 * Si una regla no se cumple se lanza DomainError con un mensaje para el usuario.
 */
import {
  DomainError, assertTransition, evalTriage, validateVitals, validateThresholds,
  allergyConflicts, validatePrescription,
} from '../lib/clinical.js';
import { ACTIVE_STATES, TRIAGE_STATION, ROLES, PRIO } from '../lib/constants.js';
import { nextTurnId, nextRecipe, nextHC, uid } from '../lib/ids.js';
import { maskDni, fullName, age } from '../lib/format.js';

export const currentThresholds = (db) =>
  [...db.thresholds].sort((a, b) => b.since - a.since)[0]?.vals;

const auditEntry = (ctx, a, d) => ({ id: uid(), t: ctx.now, u: ctx.user?.u ?? '-', a, d, ip: ctx.ip });

const findTurn = (db, id) => {
  const t = db.turns.find((x) => x.id === id);
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

  const id = nextTurnId(db.turns);
  const turn = { id, dni, adm: ctx.user.u, state: 'EN_ESPERA_TRIAJE', prio: null, t0: ctx.now };
  audit.push(auditEntry(ctx, 'TURNO_CREADO', `${id} registrado${sis === 'PENDIENTE_VALIDACION' ? ' (contingencia SIS)' : ''}`));
  return {
    changes: { patients: [patient], turns: [turn], audit },
    toast: ['ok', `Turno ${id} generado para ${fullName(patient)}. Pasa a la lista de triaje.`],
    result: turn,
  };
}

export function cancelTurn(db, ctx, id, motivo) {
  const t = findTurn(db, id);
  assertTransition(t, 'CANCELADO');
  const turn = { ...t, state: 'CANCELADO', cancel: { motivo, by: ctx.user.u, t: ctx.now } };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'TURNO_CANCELADO', `${id} · ${motivo}`)] },
    toast: ['info', `Turno ${id} cerrado: ${motivo.toLowerCase()}.`],
  };
}

/* ---------- Llamado ---------- */

export function callTurn(db, ctx, id) {
  const t = findTurn(db, id);
  const tri = t.state === 'EN_ESPERA_TRIAJE' || t.state === 'LLAMADO_TRIAJE';
  const to = tri ? 'LLAMADO_TRIAJE' : 'LLAMADO_CONSULTA';
  assertTransition(t, to);
  if (!tri && t.state === 'LLAMADO_CONSULTA' && t.dest !== ctx.area) {
    throw new DomainError(`${id} ya fue llamado a ${t.dest}.`);
  }
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
  const next = db.turns.filter((t) => t.state === waiting).sort(sorter)[0];
  if (!next) throw new DomainError('No hay pacientes en espera.');
  return callTurn(db, ctx, next.id);
}

/* ---------- Triaje ---------- */

export function startTriage(db, ctx, id) {
  const t = findTurn(db, id);
  assertTransition(t, 'EN_TRIAJE');
  const busy = db.turns.find((x) => x.state === 'EN_TRIAJE' && x.id !== id);
  if (busy) throw new DomainError(`Ya hay un paciente en triaje (${busy.id}). Finalícelo o devuélvalo a la lista.`);
  return { changes: { turns: [{ ...t, state: 'EN_TRIAJE', enf: ctx.user.u }] } };
}

export function returnToQueue(db, ctx, id) {
  const t = findTurn(db, id);
  const to = t.state === 'EN_TRIAJE' ? 'EN_ESPERA_TRIAJE' : 'EN_ESPERA_CONSULTA';
  assertTransition(t, to);
  const turn = { ...t, state: to, calledAt: null };
  return {
    changes: { turns: [turn], audit: [auditEntry(ctx, 'DEVUELTO', `${id} vuelve a la lista (${to === 'EN_ESPERA_TRIAJE' ? 'triaje' : 'consulta'})`)] },
    toast: ['info', `${id} volvió a la lista conservando su lugar.`],
  };
}

export function saveTriage(db, ctx, id, vitals, allergies) {
  const t = findTurn(db, id);
  assertTransition(t, 'EN_ESPERA_CONSULTA');
  const errs = validateVitals(vitals);
  if (Object.keys(errs).length) throw new DomainError('Revise los signos vitales marcados.');
  const tri = {
    pa: vitals.pa.trim(), fc: +vitals.fc, fr: +vitals.fr, t: +vitals.t, spo2: +vitals.spo2,
    peso: +vitals.peso, talla: +vitals.talla, motivo: vitals.motivo.trim(),
  };
  const r = evalTriage(tri, currentThresholds(db));
  const turn = { ...t, tri, prio: r.prio, state: 'EN_ESPERA_CONSULTA', tTriSave: ctx.now, enf: ctx.user.u, calledAt: null };
  const changes = { turns: [turn], audit: [auditEntry(ctx, 'TRIAJE_GUARDADO', `${id} prioridad ${r.prio}`)] };
  const p = db.patients.find((x) => x.dni === t.dni);
  if (p && (allergies ?? '').trim() !== (p.alg ?? '')) {
    changes.patients = [{ ...p, alg: allergies.trim() }];
    changes.audit.push(auditEntry(ctx, 'ALERGIAS', `${p.hc} alergias actualizadas`));
  }
  return {
    changes,
    toast: [r.prio === 'CRITICA' ? 'crit' : 'ok',
      `Triaje de ${id} guardado · prioridad ${PRIO[r.prio][0].toUpperCase()}${r.prio === 'CRITICA' ? ': pasa al inicio de la lista del médico.' : '.'}`],
  };
}

/* ---------- Consulta ---------- */

export function startConsult(db, ctx, id) {
  const t = findTurn(db, id);
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
  const t = findTurn(db, id);
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

  const rec = nextRecipe(db.turns);
  const consult = {
    notas: notas.trim(), dx, meds: list.map((m) => ({ ...m, dias: +m.dias })), dest, destx: destx?.trim() || '',
    rec, t: ctx.now, area: ctx.area, medico: { u: ctx.user.u, n: ctx.user.n, col: ctx.user.col },
  };
  const audit = [auditEntry(ctx, 'ATENCION_FINALIZADA', `${id} · ${rec} · ${dest}`)];
  if (conflicts.length) audit.push(auditEntry(ctx, 'ALERGIA_CONFIRMADA', `${id} prescripción confirmada pese a alergia: ${conflicts.map((c) => c.med).join(', ')}`));
  return {
    changes: { turns: [{ ...t, state: 'ATENDIDO', tEnd: ctx.now, consult, calledAt: null }], audit },
    toast: ['ok', `Atención finalizada (${dest}). Receta ${rec} emitida; ${ctx.area} queda libre.`],
    result: id,
  };
}

export function hcAudit(db, ctx, dni) {
  const p = db.patients.find((x) => x.dni === dni);
  return { changes: { audit: [auditEntry(ctx, 'HC_CONSULTADA', `${p?.hc} consultada`)] } };
}

/* ---------- Jefatura ---------- */

export function createUser(db, ctx, f) {
  const u = f.u.trim().toLowerCase();
  if (!/^[a-z0-9._]{4,20}$/.test(u)) throw new DomainError('El usuario debe tener de 4 a 20 caracteres (letras, números, punto o guion bajo).');
  if (db.users.some((x) => x.u === u)) throw new DomainError('Ese usuario ya existe.');
  if (!f.n.trim()) throw new DomainError('Ingrese el nombre completo.');
  if (!ROLES[f.role]) throw new DomainError('Rol no válido.');
  if (f.role === 'med' && !/^CMP-\d{5}$/.test(f.col.trim())) throw new DomainError('La colegiatura del médico debe tener el formato CMP-00000.');
  if (f.role === 'enf' && f.col.trim() && !/^CEP-\d{5}$/.test(f.col.trim())) throw new DomainError('La colegiatura de enfermería debe tener el formato CEP-00000.');
  const user = { u, n: f.n.trim(), role: f.role, col: f.col.trim(), on: true };
  return {
    changes: { users: [user], audit: [auditEntry(ctx, 'USUARIO', `${u} creado (${ROLES[f.role].n})`)] },
    toast: ['ok', `Usuario ${u} creado. Contraseña temporal de demostración: demo1234.`],
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
  return {
    changes: { audit: [auditEntry(ctx, 'RESET_CLAVE', `Clave temporal para ${u}`)] },
    toast: ['ok', `Clave temporal generada para ${u} (demo: demo1234).`],
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
