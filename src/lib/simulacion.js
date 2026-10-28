/**
 * Simulador del ciclo del paciente. Cada escenario es una lista de pasos que ejecutan las MISMAS acciones de
 * dominio que usan las estaciones (store/actions.js), sobre una copia de prueba de los datos de demostración:
 * nunca toca la base real. Así, lo que muestra el simulador (estados, prioridad, cita, boleta, receta, rechazos)
 * es exactamente lo que haría el sistema.
 *
 * Paso: { st, quien, titulo, texto, min?, hasta?, accion?, rechazo?, falla?, conexion? }
 * - st: estación (adm, caj, enf, cita, med, alta, sis, red) · quien: usuario que actúa (o función de la memoria).
 * - accion(db, ctx, mem): acción de dominio. Con `rechazo` se espera que el sistema la impida (DomainError).
 * - falla: 'servidor' | 'red'. La acción no se guarda: el sistema la deshace y avisa (como en StoreProvider.run).
 * - min: minutos que pasan antes del paso · hasta(mem): hora mínima del paso (por ejemplo, la hora de la cita).
 */
import { DomainError, isCurrent, turnKey } from './clinical.js';
import { ACTIVE_STATES, CANCEL, CIE, DAY, MIN, TRIAGE_STATION } from './constants.js';
import { fmtHora, fmtSoles, fullName, startOfDay } from './format.js';
import { especialidadSugerida, sugerirCita } from './agenda.js';
import { lastComprobante, lastRecipe } from './ids.js';
import { applyChanges } from '../data/merge.js';
import { buildSeed } from './seed.js';
import { med } from './seedHistory.js';
import {
  assignCita, callTurn, cancelTurn, createTurn, finishConsult, registerPayment, saveTriage, searchAudit, startConsult, startTriage,
} from '../store/actions.js';

const cie = (code) => CIE.find((c) => c[0] === code);
const turnoDe = (db, mem, now) => db.turns.find((t) => t.id === mem.id && isCurrent(t, now));
const pacienteDe = (db, dni) => db.patients.find((p) => p.dni === dni);
const medicoDe = (db, u) => db.users.find((x) => x.u === u)?.n ?? u;

/** Hora de inicio: hoy a las 8:00 si es día de semana; si no, el lunes siguiente (los consultorios atienden). */
export function relojInicial(now = Date.now()) {
  let d = startOfDay(now);
  while ([0, 6].includes(new Date(d).getDay())) d = startOfDay(d + DAY + 3 * 3600_000);
  return d + 8 * 60 * MIN;
}

/** Copia de prueba: personal, horarios, umbrales y pacientes con su historia, sin turnos abiertos ni de hoy. */
export function crearSandbox(reloj) {
  const seed = buildSeed(reloj);
  const turns = seed.turns.filter((t) => !ACTIVE_STATES.includes(t.state) && t.t0 < startOfDay(reloj));
  return {
    ...seed, turns, audit: [],
    meta: { recMax: lastRecipe(turns, new Date(reloj).getFullYear()), compMax: lastComprobante(turns) },
  };
}

/* ---------- Pasos reutilizables ---------- */

const NUEVA = { dni: '46000250', nom: 'Elena', ape: 'Vargas Ruiz', nac: '1990-03-15', sexo: 'F', tel: '987 654 321' };
const NUEVO_SIN_SIS = { dni: '46000257', nom: 'Marco', ape: 'Ríos Delgado', nac: '1987-08-02', sexo: 'M', tel: '987 222 333' };
const GESTANTE = { dni: '46000262', nom: 'Lucía', ape: 'Mendoza Aguirre', nac: '1997-06-20', sexo: 'F', tel: '987 444 555' };
const NORMAL = { pa: '118/76', fc: '78', fr: '16', t: '36.8', spo2: '98', peso: '64', talla: '1.62' };

const buscar = (dni, texto) => ({
  st: 'adm', quien: 'a.admision', min: 1, titulo: 'Admisión busca el DNI',
  texto, accion: (db, ctx) => searchAudit(db, ctx, dni),
});

const registrar = (dni, form, sis, texto) => ({
  st: 'adm', quien: 'a.admision', min: 2, titulo: 'Admisión genera el turno',
  texto, accion: (db, ctx) => createTurn(db, ctx, { dni, form, sis }),
});

const triaje = ({ vitals = NORMAL, motivo, falla, titulo, texto } = {}) => [
  {
    st: 'enf', quien: 'e.triaje', min: 4, titulo: 'Enfermería llama al paciente',
    texto: `El llamado aparece en la pantalla de sala con el código del turno y «${TRIAGE_STATION}». Es por código: la sala no muestra nombres.`,
    accion: (db, ctx, mem) => callTurn(db, ctx, mem.id),
  },
  {
    st: 'enf', quien: 'e.triaje', min: 1, titulo: 'Inicia el triaje',
    texto: 'Solo hay un paciente a la vez en el módulo de triaje: el sistema no deja iniciar otro hasta terminar este.',
    accion: (db, ctx, mem) => startTriage(db, ctx, mem.id),
  },
  {
    st: 'enf', quien: 'e.triaje', min: 6, falla,
    titulo: titulo || 'Registra los signos vitales',
    texto: texto || 'El sistema calcula la prioridad (normal, prioritaria o crítica) con los umbrales clínicos aprobados. Nadie la elige a mano.',
    accion: (db, ctx, mem) => saveTriage(db, ctx, mem.id, { ...vitals, motivo }, pacienteDe(db, turnoDe(db, mem, ctx.now).dni)?.alg ?? ''),
  },
];

const cita = (texto) => ({
  st: 'cita', quien: 'e.triaje', min: 1, titulo: 'Se asigna la cita',
  texto: texto || 'Al terminar el triaje se le da la cita sin volver a Admisión. El sistema propone la especialidad según el motivo y la edad (control prenatal a Obstetricia, dolor de muela a Odontología, niños a Pediatría, presión o pecho a Cardiología…) y el primer cupo libre del horario de los profesionales.',
  accion: (db, ctx, mem) => {
    const t = turnoDe(db, mem, ctx.now);
    const esp = especialidadSugerida(pacienteDe(db, t.dni), t.tri, ctx.now);
    const s = sugerirCita(db, esp, t.prio, ctx.now, turnKey(t));
    if (!s) throw new DomainError('No hay cupos libres para la especialidad.');
    return assignCita(db, ctx, mem.id, s.cita);
  },
  guarda: (res, mem) => {
    mem.med = res.result.cita.med;
    mem.area = res.result.cita.area;
    mem.at = res.result.cita.at;
  },
});

const consulta = ({ notas, dx, meds = [], dest = 'Alta', destx = '', previo = [] }) => [
  {
    st: 'med', quien: (mem) => mem.med, area: (mem) => mem.area, hasta: (mem) => mem.at, titulo: 'El médico llama al paciente',
    texto: (db, mem) => `A la hora de su cita, ${medicoDe(db, mem.med)} lo llama a ${mem.area}. Cada médico solo llama a los pacientes que tienen cita con él, y el consultorio no llama a otro mientras tiene una atención abierta.`,
    accion: (db, ctx, mem) => callTurn(db, ctx, mem.id),
  },
  {
    st: 'med', quien: (mem) => mem.med, area: (mem) => mem.area, min: 1, titulo: 'Abre la historia clínica',
    texto: (db, mem, now) => {
      const t = turnoDe(db, mem, now);
      const p = pacienteDe(db, t.dni);
      const antes = db.turns.filter((x) => x.dni === t.dni && x.state === 'ATENDIDO').length;
      return `Al abrirla, la lectura queda en la auditoría. El médico ve el triaje de hoy${p.alg ? `, la alergia registrada (${p.alg})` : ''} y ${antes ? `${antes} atención${antes > 1 ? 'es' : ''} anterior${antes > 1 ? 'es' : ''}` : 'que es su primera atención'}.`;
    },
    accion: (db, ctx, mem) => startConsult(db, ctx, mem.id),
  },
  ...previo,
  {
    st: 'med', quien: (mem) => mem.med, area: (mem) => mem.area, min: 15, titulo: 'Cierra la atención y emite la receta',
    texto: 'Se exige anamnesis y al menos un diagnóstico CIE-10. La receta recibe su número correlativo y el consultorio queda libre para el siguiente paciente.',
    accion: (db, ctx, mem) => finishConsult(db, ctx, mem.id, { notas, dx: dx.map((c) => [...cie(c), 'D']), meds, dest, destx }),
  },
];

const alta = (texto) => ({ st: 'alta', min: 1, titulo: 'Fin del ciclo', texto });

/* ---------- Escenarios ---------- */

export const ESCENARIOS = [
  {
    k: 'nuevo-sis', icon: 'shield', titulo: 'Paciente nuevo con SIS',
    resumen: 'Primera vez en el centro, asegurado: no paga y pasa directo a triaje.',
    pasos: [
      buscar(NUEVA.dni, 'El DNI no está registrado: se piden nombres, apellidos, fecha de nacimiento y teléfono. Al buscar, el sistema deja constancia en la auditoría (con el DNI enmascarado).'),
      { st: 'sis', quien: 'a.admision', min: 1, titulo: 'Verifica el seguro', texto: 'La consulta al SIS responde «SIS activo». Con seguro la consulta no se cobra.' },
      registrar(NUEVA.dni, NUEVA, 'ACTIVO', 'Se abre su historia clínica con un número nuevo (HC) y se genera el turno. Con SIS se registra un pago de S/ 0.00 sin boleta y el paciente no pasa por Caja.'),
      ...triaje({ motivo: 'Dolor de garganta y tos desde hace 2 días' }),
      cita(),
      ...consulta({ notas: 'Faringe congestiva, sin exudado. Pulmones limpios.', dx: ['J06.9'], meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)] }),
      alta('El paciente sale con su receta impresa. Desde su llegada, cada etapa quedó medida (espera de triaje, de cita y de consulta) para los indicadores de Jefatura.'),
    ],
  },
  {
    k: 'nuevo-sin-sis', icon: 'scroll', titulo: 'Paciente nuevo sin seguro',
    resumen: 'No asegurado: paga en Caja antes del triaje; el sistema controla el vuelto.',
    pasos: [
      buscar(NUEVO_SIN_SIS.dni, 'El DNI no está registrado: se toman sus datos.'),
      { st: 'sis', quien: 'a.admision', min: 1, titulo: 'Verifica el seguro', texto: 'El SIS responde «No asegurado»: deberá pagar la consulta en Caja.' },
      registrar(NUEVO_SIN_SIS.dni, NUEVO_SIN_SIS, 'NO_ASEGURADO', 'El turno queda «Pendiente de pago». Aún no entra a la lista de triaje: Admisión le indica que pase a la caja que esté libre.'),
      {
        st: 'caj', quien: 'c.caja', min: 3, rechazo: true, titulo: 'Caja intenta cobrar con S/ 10.00',
        texto: 'La consulta cuesta S/ 20.00. El sistema no deja registrar un pago en efectivo que no cubre la tarifa.',
        accion: (db, ctx, mem) => registerPayment(db, ctx, mem.id, { metodo: 'EFECTIVO', recibido: 10 }),
      },
      {
        st: 'caj', quien: 'c.caja', min: 1, titulo: 'Cobra con un billete de S/ 50.00',
        texto: `Vuelto: ${fmtSoles(30)}. Se emite la boleta con su número correlativo (serie B001) y el paciente pasa a la lista de triaje.`,
        accion: (db, ctx, mem) => registerPayment(db, ctx, mem.id, { metodo: 'EFECTIVO', recibido: 50 }),
      },
      ...triaje({ motivo: 'Dolor lumbar al cargar peso' }),
      cita(),
      ...consulta({ notas: 'Contractura paravertebral lumbar, Lasègue negativo.', dx: ['M54.5'], meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 5)], dest: 'Reposo médico', destx: '2' }),
      alta('Sale con receta y 2 días de reposo médico. Caja ve el cobro en su cuadre del día por medio de pago.'),
    ],
  },
  {
    k: 'historial', icon: 'folder', titulo: 'Paciente con historial',
    resumen: 'Ya tiene historia y una alergia: el sistema bloquea una receta peligrosa.',
    pasos: [
      buscar('70000001', (db) => {
        const p = pacienteDe(db, '70000001');
        return `${fullName(p)} ya tiene su historia ${p.hc}: no se vuelve a registrar. Admisión solo confirma su teléfono.`;
      }),
      { st: 'sis', quien: 'a.admision', min: 1, titulo: 'Verifica el seguro', texto: 'SIS activo: no paga.' },
      registrar('70000001', { tel: '999 000 101' }, 'ACTIVO', 'El turno se genera con la misma historia clínica: todo lo de hoy se suma a sus atenciones anteriores.'),
      ...triaje({ vitals: { ...NORMAL, t: '38.6', fc: '96' }, motivo: 'Fiebre y dolor de garganta' }),
      cita(),
      ...consulta({
        notas: 'Amígdalas hipertróficas con exudado. Faringoamigdalitis bacteriana probable.',
        dx: ['J06.9'],
        meds: [med('Azitromicina 500 mg', '1 tableta', 'cada 24 h', 3), med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)],
        previo: [{
          st: 'med', quien: (mem) => mem.med, area: (mem) => mem.area, min: 10, rechazo: true, titulo: 'Intenta recetar amoxicilina',
          texto: 'La paciente es alérgica a la penicilina. El sistema cruza la receta con la alergia registrada y no la deja emitir sin una confirmación explícita.',
          accion: (db, ctx, mem) => finishConsult(db, ctx, mem.id, {
            notas: 'Faringoamigdalitis.', dx: [[...cie('J06.9'), 'D']], meds: [med('Amoxicilina 500 mg', '1 cápsula', 'cada 8 h', 7)], dest: 'Alta', destx: '',
          }),
        }],
      }),
      alta('El médico cambió a azitromicina. La historia de la paciente suma esta atención a las anteriores.'),
    ],
  },
  {
    k: 'prenatal', icon: 'bed', titulo: 'Gestante: control prenatal',
    resumen: 'El motivo lleva la cita a Obstetricia, en la rama materno-infantil.',
    pasos: [
      buscar(GESTANTE.dni, 'Gestante sin historia en el centro: se toman sus datos.'),
      { st: 'sis', quien: 'a.admision', min: 1, titulo: 'Verifica el seguro', texto: 'SIS activo: la gestante no paga.' },
      registrar(GESTANTE.dni, GESTANTE, 'ACTIVO', 'Turno generado. Con SIS pasa directo a triaje.'),
      ...triaje({ motivo: 'Control prenatal', vitals: { ...NORMAL, pa: '110/70', peso: '66' } }),
      cita('Por el motivo «Control prenatal», el sistema propone Obstetricia (rama materno-infantil) y el primer cupo libre de la obstetra en el consultorio 6. No pasa por Medicina General.'),
      ...consulta({
        notas: 'Gestación de 20 semanas, altura uterina acorde, latidos fetales presentes. Se indica suplemento.',
        dx: ['Z34.9'],
        meds: [med('Ácido fólico 0.5 mg', '1 tableta', 'cada 24 h', 30), med('Sulfato ferroso 300 mg', '1 tableta', 'cada 24 h', 30)],
      }),
      alta('Sale con su receta de suplementos. En el tablero cuenta en la especialidad Obstetricia; el resto de la cartera (CRED, Odontología, Psicología, Nutrición…) funciona igual.'),
    ],
  },
  {
    k: 'critico', icon: 'ambulance', titulo: 'Paciente crítico',
    resumen: 'El triaje detecta una saturación baja: sobrecupo inmediato y derivación.',
    pasos: [
      buscar('70000002', (db) => `${fullName(pacienteDe(db, '70000002'))} llega con falta de aire. Tiene historia (hipertensión arterial).`),
      registrar('70000002', { tel: '999 000 102' }, 'ACTIVO', 'Con SIS pasa directo a triaje.'),
      ...triaje({
        vitals: { pa: '150/95', fc: '124', fr: '32', t: '38.9', spo2: '86', peso: '82', talla: '1.70' },
        motivo: 'Falta de aire y fiebre desde ayer',
        titulo: 'Signos vitales: SpO₂ 86 %',
        texto: 'Saturación bajo el umbral crítico y frecuencia respiratoria alta: el sistema marca prioridad CRÍTICA y lo avisa en todas las estaciones.',
      }),
      cita('Prioridad crítica: no espera un cupo. El sistema asigna un sobrecupo ahora mismo con el médico que está atendiendo, y el paciente pasa primero en la cola de consulta.'),
      ...consulta({ notas: 'Crepitantes en base derecha, SpO₂ 86 %. Neumonía con insuficiencia respiratoria.', dx: ['J18.9'], dest: 'Derivación a hospital', destx: 'Hospital Nacional (demo)' }),
      alta('Sale derivado al hospital. En el tablero de Jefatura cuenta como paciente crítico y se mide si se atendió dentro de los 5 minutos objetivo.'),
    ],
  },
  {
    k: 'sis-caido', icon: 'satellite', titulo: 'Caída del SIS',
    resumen: 'El servicio del SIS no responde: la atención no se detiene (contingencia).',
    pasos: [
      buscar(NUEVA.dni, 'Paciente nuevo: se toman sus datos.'),
      {
        st: 'sis', quien: 'a.admision', min: 1, conexion: 'sis', titulo: 'El SIS no responde',
        texto: 'Pasado el tiempo límite, el sistema no deja al paciente esperando: registra su seguro como «Pendiente de validación» (modo contingencia, Regla 6). En Admisión se prueba con «Probar SIS caído».',
      },
      registrar(NUEVA.dni, NUEVA, 'PENDIENTE_VALIDACION', 'Mientras se valida, se atiende como asegurado: no paga y pasa a triaje. El turno queda marcado como «contingencia SIS» en la auditoría.'),
      ...triaje({ motivo: 'Dolor de cabeza intenso' }),
      cita(),
      ...consulta({ notas: 'Cefalea tensional, examen neurológico normal.', dx: ['R51'], meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)] }),
      { st: 'sis', quien: 'a.admision', min: 30, titulo: 'El SIS vuelve', texto: 'En su próxima visita, la verificación confirma el seguro y el estado pasa a «SIS activo». Si no tuviera seguro, pagaría desde esa visita.' },
    ],
  },
  {
    k: 'servidor', icon: 'warning', titulo: 'Caída del servidor',
    resumen: 'El servidor falla al guardar el triaje: el sistema no pierde ni inventa datos.',
    pasos: [
      buscar('70000005', (db) => `${fullName(pacienteDe(db, '70000005'))}, con historia y SIS.`),
      registrar('70000005', { tel: '999 000 105' }, 'ACTIVO', 'Turno generado: pasa a triaje.'),
      ...triaje({
        motivo: 'Dolor abdominal leve', falla: 'servidor', titulo: 'Guarda el triaje… y el servidor falla',
        texto: 'El servidor no responde. Cada acción se guarda en una sola transacción: o se guarda completa o no se guarda nada. La pantalla deshace el cambio, avisa «No se guardó» y el indicador pasa a «Sin conexión». El formulario conserva los signos escritos.',
      }),
      { st: 'red', quien: 'e.triaje', min: 3, titulo: 'El servidor vuelve', texto: 'La app recarga los datos sola. El turno sigue «En triaje», tal como estaba: no se perdió ni se duplicó nada.' },
      ...triaje({ motivo: 'Dolor abdominal leve' }).slice(2).map((p) => ({ ...p, titulo: 'Vuelve a guardar el triaje', texto: 'Ahora se guarda. Si dos estaciones intentan lo mismo a la vez, la base de datos solo acepta una (por ejemplo, un cupo de cita o un número de boleta).' })),
      cita(),
      ...consulta({ notas: 'Abdomen blando, dolor epigástrico leve.', dx: ['K29.7'], meds: [med('Omeprazol 20 mg', '1 cápsula', 'en ayunas', 14)] }),
      alta('El ciclo terminó normalmente pese a la caída.'),
    ],
  },
  {
    k: 'sin-conexion', icon: 'locked', titulo: 'Prueba sin conexión',
    resumen: 'Caja pierde internet al cobrar: no se emite boleta hasta que vuelve la red.',
    pasos: [
      buscar('70000004', (db) => `${fullName(pacienteDe(db, '70000004'))}, no asegurado, ya tiene historia.`),
      registrar('70000004', { tel: '999 000 104' }, 'NO_ASEGURADO', 'Debe pagar en Caja.'),
      {
        st: 'caj', quien: 'c.caja', min: 3, falla: 'red', conexion: 'red', titulo: 'Caja cobra… sin internet',
        texto: 'El equipo de Caja perdió la conexión. El sistema lo detecta y lo muestra en la barra superior. El pago no se registra y NO se imprime boleta: así no se cobra dos veces ni queda una boleta sin respaldo.',
        accion: (db, ctx, mem) => registerPayment(db, ctx, mem.id, { metodo: 'TARJETA' }),
      },
      { st: 'red', quien: 'c.caja', min: 2, titulo: 'Vuelve la conexión', texto: 'Al volver la red, la app avisa «Conexión restablecida» y recarga los datos sola: el turno sigue «Pendiente de pago».' },
      {
        st: 'caj', quien: 'c.caja', min: 1, titulo: 'Cobra de nuevo',
        texto: 'Ahora se registra el pago con tarjeta y se emite la boleta. El paciente pasa a triaje.',
        accion: (db, ctx, mem) => registerPayment(db, ctx, mem.id, { metodo: 'TARJETA' }),
      },
      ...triaje({ motivo: 'Dolor de cabeza y mareo', vitals: { ...NORMAL, pa: '138/88' } }),
      cita(),
      ...consulta({ notas: 'Cefalea tensional, presión arterial en rango.', dx: ['R51'], meds: [med('Paracetamol 500 mg', '1 tableta', 'cada 8 h', 3)] }),
      alta('Ciclo completo. Otras estaciones conectadas no se enteraron del corte: solo Caja quedó en espera.'),
    ],
  },
  {
    k: 'no-se-presenta', icon: 'megaphone', titulo: 'No se presenta al llamado',
    resumen: 'Se le llama dos veces y no acude: el turno se cierra y cuenta como abandono.',
    pasos: [
      buscar('70000006', (db) => `${fullName(pacienteDe(db, '70000006'))} saca su turno.`),
      registrar('70000006', { tel: '999 000 106' }, 'ACTIVO', 'Con SIS pasa a la lista de triaje.'),
      triaje({ motivo: '-' })[0],
      {
        st: 'enf', quien: 'e.triaje', min: 3, titulo: 'Lo llama otra vez',
        texto: 'Nadie se acerca. El llamado se repite en la pantalla de sala y el sistema cuenta las veces.',
        accion: (db, ctx, mem) => callTurn(db, ctx, mem.id),
      },
      {
        st: 'enf', quien: 'e.triaje', min: 3, titulo: 'Cierra el turno',
        texto: 'Se cierra con el motivo «No se presentó al llamado». La sala deja de mostrarlo y el siguiente paciente puede pasar.',
        accion: (db, ctx, mem) => cancelTurn(db, ctx, mem.id, CANCEL.noShow),
      },
      alta('En los indicadores de Jefatura cuenta como abandono, junto con los que no pagan o no asisten a su cita.'),
    ],
  },
];

/**
 * Ejecuta un escenario de principio a fin y devuelve una foto por paso:
 * { paso, n, quien, now, db, turno, paciente, toast, error, audit, conexion }.
 * Si el sistema responde distinto de lo previsto (por ejemplo, un día sin cupos), la simulación se detiene en
 * ese paso con `inesperado` y el motivo, en lugar de mostrar un resultado que no es el real.
 */
export function ejecutar(esc, base, reloj) {
  let db = base;
  let now = reloj;
  const mem = {};
  const fotos = [];
  for (const [n, p] of esc.pasos.entries()) {
    now = Math.max(now + (p.min ?? 2) * MIN, p.hasta?.(mem) ?? 0);
    const quien = db.users.find((u) => u.u === (typeof p.quien === 'function' ? p.quien(mem) : p.quien)) || null;
    const ctx = { user: quien, area: typeof p.area === 'function' ? p.area(mem) : undefined, now, ip: '' };
    let res = null;
    let error = null;
    if (p.accion) {
      try {
        res = p.accion(db, ctx, mem);
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        error = e.message;
      }
    }
    const inesperado = (error && !p.rechazo) || (!error && p.rechazo);
    if (inesperado && !error) error = 'El sistema aceptó una acción que debía impedir.';
    let audit = [];
    if (inesperado) {
      res = null;
    } else if (res && p.falla) {
      error = p.falla === 'red' ? 'No hay conexión con el servidor.' : 'El servidor no respondió (error 503).';
    } else if (res) {
      db = applyChanges(db, res.changes);
      audit = res.changes.audit || [];
      if (!mem.id && res.result?.id && res.result.dni) mem.id = res.result.id;
      p.guarda?.(res, mem);
    }
    const turno = mem.id ? turnoDe(db, mem, now) : null;
    fotos.push({
      paso: p, n, quien, now, db, turno, inesperado,
      paciente: turno ? pacienteDe(db, turno.dni) : null,
      texto: typeof p.texto === 'function' ? p.texto(db, mem, now) : p.texto,
      toast: res && !p.falla ? res.toast : null,
      error, audit,
      conexion: p.falla === 'red' || p.conexion === 'red' ? 'red' : p.falla === 'servidor' ? 'servidor' : p.conexion === 'sis' ? 'sis' : 'ok',
      sala: turno?.calledAt === now ? `${turno.id} → ${turno.dest}` : null,
      cita: turno?.cita ? `${fmtHora(turno.cita.at)} con ${medicoDe(db, turno.cita.med)} (${turno.cita.area})${turno.cita.sobre ? ', sobrecupo' : ''}` : null,
    });
    if (inesperado) break;
  }
  return fotos;
}
