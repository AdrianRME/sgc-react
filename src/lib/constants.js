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
 */
export const ROLES = {
  adm: {
    n: 'Admisión', slug: 'admision', icon: 'idcard', space: 'Espacio de Admisión', tag: 'Registro de pacientes y turnos',
    sections: [['registro', 'Registro y turnos', 'ticket'], ['flujo', 'Flujo en vivo', 'satellite']],
  },
  enf: {
    n: 'Enfermería', slug: 'triaje', icon: 'thermometer', space: 'Espacio de Triaje', tag: 'Signos vitales y prioridad',
    sections: [['lista', 'Lista de triaje', 'clipboard']],
  },
  med: {
    n: 'Médico', slug: 'consulta', icon: 'stethoscope', space: 'Espacio del Médico', tag: 'Consulta, diagnóstico y receta',
    sections: [['atencion', 'Mis pacientes', 'stethoscope'], ['historias', 'Historias clínicas', 'folder']],
  },
  jef: {
    n: 'Jefatura', slug: 'jefatura', icon: 'barchart', space: 'Espacio de Jefatura', tag: 'Indicadores, usuarios y control',
    sections: [
      ['tablero', 'Tablero gerencial', 'barchart'], ['flujo', 'Flujo en vivo', 'satellite'], ['usuarios', 'Usuarios', 'people'],
      ['auditoria', 'Auditoría', 'scroll'], ['umbrales', 'Umbrales clínicos', 'knobs'],
    ],
  },
};

/** Días de historia que genera la demostración (el tablero compara periodos dentro de este rango). */
export const HISTORY_DAYS = 35;

/** Política de contraseñas (también la valida la base de datos). */
export const PASSWORD_RULE = { min: 8, re: /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/, text: 'Mínimo 8 caracteres, con letras y números.' };

/** Estados del turno: [etiqueta, tono del badge]. */
export const STATE = {
  EN_ESPERA_TRIAJE: ['En espera de triaje', 'info'],
  LLAMADO_TRIAJE: ['Llamado a triaje', 'ok'],
  EN_TRIAJE: ['En triaje', 'warn'],
  EN_ESPERA_CONSULTA: ['En espera de consulta', 'info'],
  LLAMADO_CONSULTA: ['Llamado a consulta', 'ok'],
  EN_CONSULTA: ['En consulta', 'warn'],
  ATENDIDO: ['Atendido', 'mut'],
  CANCELADO: ['Cancelado', 'mut'],
};

/** Estados que esperan la acción de cada estación (cola y contador del menú). */
export const QUEUE = {
  enf: ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE'],
  med: ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA'],
};

export const ACTIVE_STATES = [
  'EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE',
  'EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA',
];

/**
 * La ruta del paciente: cada estación tiene su color (el del rol que la atiende) y los estados
 * del turno que pertenecen a ella. Admisión no tiene estados propios: el turno nace en triaje.
 */
export const ROUTE = [
  { k: 'adm', n: 'Admisión', states: [] },
  { k: 'enf', n: 'Triaje', states: ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE'] },
  { k: 'med', n: 'Consulta', states: ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA'] },
  { k: 'alta', n: 'Alta', states: ['ATENDIDO'] },
];

/**
 * Etapas de la ruta: qué estados del turno caen en cada una (tablero en vivo) y entre qué marcas
 * de tiempo se mide su duración (indicadores). `st` es la estación a la que pertenecen.
 */
export const STAGES = [
  { k: 'espTri', n: 'Espera de triaje', st: 'enf', wait: true, states: ['EN_ESPERA_TRIAJE'], from: 't0', to: 'tTriCall' },
  { k: 'tri', n: 'Triaje', st: 'enf', wait: false, states: ['LLAMADO_TRIAJE', 'EN_TRIAJE'], from: 'tTriCall', to: 'tTriSave' },
  { k: 'espMed', n: 'Espera de consulta', st: 'med', wait: true, states: ['EN_ESPERA_CONSULTA'], from: 'tTriSave', to: 'tMedCall' },
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

/** Tiempo objetivo de espera por prioridad (min). Se marca en rojo al superarlo. */
export const WAIT_TARGET = { CRITICA: 5, PRIORITARIA: 20, NORMAL: 60, SIN_TRIAJE: 30 };

export const SIS = {
  ACTIVO: ['SIS activo', 'ok'],
  NO_ASEGURADO: ['No asegurado', 'mut'],
  PENDIENTE_VALIDACION: ['Pendiente de validación', 'warn'],
};

export const TRIAGE_STATION = 'Módulo de Triaje 1';
export const AREAS = ['Consultorio 1', 'Consultorio 2'];

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

/** Motivos de cierre de un turno sin atención. Los dos primeros cuentan como abandono en el tablero. */
export const CANCEL = {
  noShow: 'No se presentó al llamado',
  retiro: 'Retiro voluntario del paciente',
  anulado: 'Anulado en admisión',
  duplicado: 'Registro duplicado',
};
export const ABANDONO = [CANCEL.noShow, CANCEL.retiro];

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
  'a.admision': '192.168.1.11', 'e.triaje': '192.168.1.12',
  'm.consulta': '192.168.1.20', 'm.consulta2': '192.168.1.21', 'j.jefatura': '192.168.1.30',
};
