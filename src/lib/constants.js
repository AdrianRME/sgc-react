export const MIN = 60_000;
export const DAY = 86_400_000;

/** Contraseña del modo local (sin Supabase), solo para desarrollo. Con Supabase se usa Supabase Auth. */
export const DEMO_PASSWORD = 'SgcDemo2026';
export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCK_MS = 30_000;
/** Dominio de las cuentas de Supabase Auth: el usuario a.admision ingresa como a.admision@sgc.example.org. */
export const AUTH_DOMAIN = 'sgc.example.org';
/** Cierre de sesión automático tras este tiempo sin actividad (equipos compartidos). */
export const IDLE_MS = 15 * MIN;
export const IDLE_WARN_MS = 60_000;

/**
 * Cada rol tiene su propio espacio de trabajo con su dirección (#/admision, #/triaje…),
 * su color y sus módulos. La pantalla de sala es pública y no pertenece a ningún rol.
 * `queue` es la sección que lleva el contador de pacientes en espera (por defecto, la primera).
 */
export const ROLES = {
  adm: {
    n: 'Admisión', slug: 'admision', icon: 'idcard', prefix: 'a.', space: 'Espacio de Admisión', tag: 'Registro, citas y llegada de pacientes',
    queue: 'citas',
    // En el orden en que llega el paciente: ventanilla, cita después del triaje, agenda y el flujo del centro
    sections: [
      ['registro', 'Ventanilla', 'ticket'], ['citas', 'Asignar citas', 'calendar'], ['agenda', 'Agenda de citas', 'clipboard'],
      ['flujo', 'Flujo en vivo', 'satellite'],
    ],
  },
  caj: {
    n: 'Caja', slug: 'caja', icon: 'scroll', prefix: 'c.', space: 'Espacio de Caja', tag: 'Cobro de la consulta y comprobantes',
    sections: [['cobros', 'Cobros', 'scroll']],
  },
  enf: {
    n: 'Enfermería', slug: 'triaje', icon: 'thermometer', prefix: 'e.', space: 'Espacio de Triaje', tag: 'Signos vitales y prioridad',
    sections: [['lista', 'Lista de triaje', 'clipboard']],
  },
  med: {
    n: 'Médico', slug: 'consulta', icon: 'stethoscope', prefix: 'm.', space: 'Espacio del Médico', tag: 'Consulta, diagnóstico y receta',
    sections: [['atencion', 'Mis pacientes', 'stethoscope'], ['historias', 'Historias clínicas', 'folder']],
  },
  jef: {
    n: 'Jefatura', slug: 'jefatura', icon: 'barchart', prefix: 'j.', space: 'Espacio de Jefatura', tag: 'Indicadores, usuarios y control',
    sections: [
      ['tablero', 'Tablero gerencial', 'barchart'], ['flujo', 'Flujo en vivo', 'satellite'], ['usuarios', 'Usuarios', 'people'],
      ['horarios', 'Horarios médicos', 'calendar'], ['auditoria', 'Auditoría', 'scroll'], ['umbrales', 'Umbrales clínicos', 'knobs'],
    ],
  },
};

/**
 * El usuario empieza con el prefijo de su rol (a.admision, m.cardio…). Así el inicio de sesión reconoce el área
 * mientras se escribe, sin consultar al servidor: no revela si la cuenta existe.
 */
export const roleFromUsername = (u) => {
  const x = String(u || '').trim().toLowerCase();
  return Object.keys(ROLES).find((k) => x.startsWith(ROLES[k].prefix)) ?? null;
};

/** Guía de cada espacio: qué hace el rol y sus cuatro pasos (encabezado del espacio e inicio de sesión). */
export const GUIDE = {
  adm: {
    lead: 'Identifique al paciente por DNI y verifique el SIS. Con SIS pasa directo a triaje; sin seguro, primero paga en Caja. La cita se la dan en el triaje; el día de su cita, registre aquí su llegada.',
    steps: ['Busque al paciente por DNI', 'Verifique el SIS', 'Genere el turno y entregue el ticket', 'El día de la cita, registre su llegada'],
  },
  caj: {
    lead: 'Cobre la consulta a los pacientes sin seguro y entregue la boleta. Al pagar, el paciente pasa a la lista de triaje.',
    steps: ['Elija al paciente por cobrar', 'Elija el medio de pago', 'Registre el pago', 'Entregue la boleta'],
  },
  enf: {
    lead: 'Llame al siguiente paciente y registre sus signos vitales. El sistema calcula el IMC y la prioridad, y al terminar propone su cita: confírmela y el paciente va directo a su consulta.',
    steps: ['Llame al siguiente', 'Inicie el triaje', 'Registre los signos vitales', 'Guarde y confirme la cita'],
  },
  med: {
    lead: 'Solo ve a los pacientes que tienen cita con usted y ya llegaron, ordenados por prioridad clínica y hora de la cita. Al cerrar la atención se emite la receta.',
    steps: ['Revise su agenda de hoy', 'Llame al siguiente', 'Inicie la atención', 'Diagnóstico, receta y alta'],
  },
  jef: {
    lead: 'Supervise los tiempos de atención, administre las cuentas del personal, registre los umbrales clínicos y revise la auditoría.',
    steps: ['Revise el tablero gerencial', 'Siga el flujo en vivo', 'Gestione usuarios y umbrales', 'Revise la auditoría'],
  },
};

/** Días de historia que genera la demostración (el tablero compara periodos dentro de este rango). */
export const HISTORY_DAYS = 35;

/** Política de contraseñas (también la valida la base de datos). */
export const PASSWORD_RULE = { min: 8, re: /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/, text: 'Mínimo 8 caracteres, con letras y números.' };

/**
 * Estados del turno: [etiqueta, tono del badge]. La ruta es pago → triaje → cita → consulta.
 * Si la cita es otro día, el turno queda CITADO hasta que el paciente vuelve y Admisión registra su llegada.
 */
export const STATE = {
  PENDIENTE_PAGO: ['Pendiente de pago', 'warn'],
  EN_ESPERA_TRIAJE: ['En espera de triaje', 'info'],
  LLAMADO_TRIAJE: ['Llamado a triaje', 'ok'],
  EN_TRIAJE: ['En triaje', 'warn'],
  PENDIENTE_CITA: ['Pendiente de cita', 'info'],
  CITADO: ['Cita programada', 'info'],
  EN_ESPERA_CONSULTA: ['En espera de consulta', 'info'],
  LLAMADO_CONSULTA: ['Llamado a consulta', 'ok'],
  EN_CONSULTA: ['En consulta', 'warn'],
  ATENDIDO: ['Atendido', 'mut'],
  CANCELADO: ['Cancelado', 'mut'],
};

/** Estados que esperan la acción de cada estación (cola y contador del menú). */
export const QUEUE = {
  caj: ['PENDIENTE_PAGO'],
  enf: ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE'],
  adm: ['PENDIENTE_CITA'],
  med: ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA'],
};

export const ACTIVE_STATES = [
  'PENDIENTE_PAGO', 'EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE', 'PENDIENTE_CITA', 'CITADO',
  'EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA',
];

/**
 * La ruta del paciente: cada estación tiene su color (`c`, el del rol que la atiende) y los estados
 * del turno que pertenecen a ella. Admisión registra al paciente y, después del triaje, le da la cita.
 */
export const ROUTE = [
  { k: 'adm', n: 'Admisión', c: 'adm', states: [] },
  { k: 'caj', n: 'Caja', c: 'caj', states: ['PENDIENTE_PAGO'] },
  { k: 'enf', n: 'Triaje', c: 'enf', states: ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'] },
  { k: 'cita', n: 'Cita', c: 'adm', states: ['PENDIENTE_CITA', 'CITADO'] },
  { k: 'med', n: 'Consulta', c: 'med', states: ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'] },
  { k: 'alta', n: 'Alta', c: 'jef', states: ['ATENDIDO'] },
];

/**
 * Etapas de la ruta: qué estados del turno caen en cada una (tablero en vivo) y entre qué marcas
 * de tiempo se mide su duración (indicadores). `st` es la estación a la que pertenecen.
 * La espera de consulta empieza en `tLlega`: la llegada del paciente o la hora de su cita, la que sea
 * posterior. Así no se cuenta como espera el tiempo que falta para el día y la hora de la cita.
 */
export const STAGES = [
  { k: 'espPago', n: 'Espera de pago', st: 'caj', wait: true, states: ['PENDIENTE_PAGO'], from: 't0', to: 'tPago' },
  { k: 'espTri', n: 'Espera de triaje', st: 'enf', wait: true, states: ['EN_ESPERA_TRIAJE'], from: 'tPago', to: 'tTriCall' },
  { k: 'tri', n: 'Triaje', st: 'enf', wait: false, states: ['LLAMADO_TRIAJE', 'EN_TRIAJE'], from: 'tTriCall', to: 'tTriSave' },
  { k: 'espCita', n: 'Espera de cita', st: 'adm', wait: true, states: ['PENDIENTE_CITA'], from: 'tTriSave', to: 'tCita' },
  { k: 'espMed', n: 'Espera de consulta', st: 'med', wait: true, states: ['EN_ESPERA_CONSULTA'], from: 'tLlega', to: 'tMedCall' },
  { k: 'med', n: 'Consulta', st: 'med', wait: false, states: ['LLAMADO_CONSULTA', 'EN_CONSULTA'], from: 'tMedCall', to: 'tEnd' },
];

/** Etapas de vida del MINSA, para el perfil de pacientes. */
export const GRUPOS_EDAD = [
  ['nino', 'Niño', 0, 11],
  ['adolescente', 'Adolescente', 12, 17],
  ['joven', 'Joven', 18, 29],
  ['adulto', 'Adulto', 30, 59],
  ['mayor', 'Adulto mayor', 60, 200],
];

export const PRIO = {
  CRITICA: ['Crítica', 'crit'],
  PRIORITARIA: ['Prioritaria', 'warn'],
  NORMAL: ['Normal', 'ok'],
};

/**
 * Tiempo objetivo de espera (min). Se marca en rojo al superarlo. La espera de consulta depende de la
 * prioridad de triaje; las demás esperas tienen un objetivo por etapa.
 */
export const WAIT_TARGET = { CRITICA: 5, PRIORITARIA: 20, NORMAL: 60, espPago: 15, espTri: 30, espCita: 15 };

export const SIS = {
  ACTIVO: ['SIS activo', 'ok'],
  NO_ASEGURADO: ['No asegurado', 'mut'],
  PENDIENTE_VALIDACION: ['Pendiente de validación', 'warn'],
};

export const TRIAGE_STATION = 'Módulo de Triaje 1';
export const AREAS = ['Consultorio 1', 'Consultorio 2'];

/* ---------- Caja ---------- */

/** Tarifa de la consulta externa (S/). La paga el paciente no asegurado antes del triaje. */
export const TARIFA_CONSULTA = 20;
export const CONCEPTO_PAGO = 'Consulta externa';
/** Medios de pago. SIS: el seguro cubre la consulta y se registra un pago de S/ 0.00 sin comprobante. */
export const METODOS_PAGO = { EFECTIVO: 'Efectivo', TARJETA: 'Tarjeta', BILLETERA: 'Yape o Plin', SIS: 'SIS (exonerado)' };
/** Condiciones de seguro exoneradas del pago. En contingencia (SIS sin validar) no se detiene la atención. */
export const SIS_EXONERADO = ['ACTIVO', 'PENDIENTE_VALIDACION'];
export const SERIE_BOLETA = 'B001';

/* ---------- Citas ---------- */

/**
 * Especialidades del centro. `dur` es la duración de cada cita (min): el horario de cada médico se
 * divide en cupos de esa duración.
 */
export const ESPECIALIDADES = [
  { k: 'MG', n: 'Medicina General', dur: 20 },
  { k: 'PED', n: 'Pediatría', dur: 20 },
  { k: 'CAR', n: 'Cardiología', dur: 30 },
];
/** Hasta cuántos días adelante se pueden dar citas. */
export const CITA_DIAS_MAX = 30;
/** Días de la semana con numeración ISO (1 = lunes … 7 = domingo), igual que en la base. */
export const DIAS_SEMANA = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo']];

export const CIE = [
  ['J00', 'Rinofaringitis aguda (resfriado común)'],
  ['J06.9', 'Infección aguda de vías respiratorias superiores, no especificada'],
  ['J10.1', 'Influenza con otras manifestaciones respiratorias (gripe)'],
  ['J20.9', 'Bronquitis aguda, no especificada'],
  ['J18.9', 'Neumonía, no especificada'],
  ['J45.9', 'Asma, no especificada'],
  ['I10', 'Hipertensión esencial (primaria)'],
  ['E11.9', 'Diabetes mellitus tipo 2, sin complicaciones'],
  ['K29.7', 'Gastritis, no especificada'],
  ['N39.0', 'Infección de vías urinarias, sitio no especificado'],
  ['A09', 'Diarrea y gastroenteritis de presunto origen infeccioso'],
  ['R51', 'Cefalea'],
  ['M54.5', 'Lumbago (dolor lumbar bajo)'],
  ['B34.9', 'Infección viral, no especificada'],
  ['R50.9', 'Fiebre, no especificada'],
];

/** Catálogo de medicamentos con grupos para el cruce con alergias. */
export const MEDS = [
  { n: 'Paracetamol 500 mg', g: ['paracetamol', 'acetaminofen'] },
  { n: 'Ibuprofeno 400 mg', g: ['ibuprofeno', 'aine', 'antiinflamatorio'] },
  { n: 'Naproxeno 550 mg', g: ['naproxeno', 'aine', 'antiinflamatorio'] },
  { n: 'Amoxicilina 500 mg', g: ['amoxicilina', 'penicilina', 'betalactamico'] },
  { n: 'Azitromicina 500 mg', g: ['azitromicina', 'macrolido'] },
  { n: 'Salbutamol inhalador', g: ['salbutamol'] },
  { n: 'Loratadina 10 mg', g: ['loratadina', 'antihistaminico'] },
  { n: 'Omeprazol 20 mg', g: ['omeprazol'] },
  { n: 'Suero de rehidratación oral', g: [] },
  { n: 'Enalapril 10 mg', g: ['enalapril', 'ieca'] },
  { n: 'Metformina 850 mg', g: ['metformina'] },
  { n: 'Nitrofurantoína 100 mg', g: ['nitrofurantoina'] },
];

export const DESTINOS = ['Alta', 'Reposo médico', 'Derivación a hospital'];

/** Motivos de cierre de un turno sin atención. Los de ABANDONO cuentan como abandono en el tablero. */
export const CANCEL = {
  noShow: 'No se presentó al llamado',
  retiro: 'Retiro voluntario del paciente',
  sinPago: 'No realizó el pago',
  noAsistio: 'No asistió a su cita',
  anulado: 'Anulado en admisión',
  duplicado: 'Registro duplicado',
};
export const ABANDONO = [CANCEL.noShow, CANCEL.retiro, CANCEL.sinPago, CANCEL.noAsistio];

export const TH_FIELDS = [
  // clave crítica, clave alerta, etiqueta, regla, paso
  ['spo2', 'spo2A', 'SpO₂ (%)', 'crítico si <, alerta si ≤', 1],
  ['tmp', 'tmpA', 'Temperatura (°C)', 'crítico y alerta si ≥', 0.1],
  ['pasLo', 'pasA', 'PAS (mmHg)', 'crítico si <, alerta si ≥', 1],
  ['fcHi', 'fcA', 'FC (lpm)', 'crítico si >, alerta si >', 1],
  ['frHi', 'frA', 'FR (rpm)', 'crítico si >, alerta si ≥', 1],
];

export const TH_DEFAULT = {
  spo2: 90, spo2A: 93, tmp: 40, tmpA: 38.5, pasLo: 80, pasA: 180,
  fcHi: 130, fcA: 110, frHi: 30, frA: 25,
};

export const FAKE_IPS = {
  'a.admision': '192.168.1.11', 'e.triaje': '192.168.1.12', 'c.caja': '192.168.1.13',
  'm.consulta': '192.168.1.20', 'm.consulta2': '192.168.1.21', 'm.pediatria': '192.168.1.22', 'm.cardio': '192.168.1.23',
  'j.jefatura': '192.168.1.30',
};
