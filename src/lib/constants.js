export const MIN = 60_000;
export const DAY = 86_400_000;

/** Contraseña única de demostración. En producción: Supabase Auth / JWT + Argon2id. */
export const DEMO_PASSWORD = 'demo1234';
export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCK_MS = 30_000;

export const ROLES = {
  adm: { n: 'Admisión', mods: ['adm'] },
  enf: { n: 'Enfermería', mods: ['enf'] },
  med: { n: 'Médico', mods: ['med'] },
  jef: { n: 'Jefatura', mods: ['jef'] },
};

export const MODULES = {
  adm: 'Admisión',
  enf: 'Triaje',
  med: 'Consulta médica',
  jef: 'Jefatura',
  sala: 'Pantalla de sala',
};

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

export const ACTIVE_STATES = [
  'EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE',
  'EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA',
];

/** Etapas visibles del recorrido del paciente (para el indicador de pasos). */
export const FLOW = [
  ['Admisión', []],
  ['Triaje', ['EN_ESPERA_TRIAJE', 'LLAMADO_TRIAJE', 'EN_TRIAJE']],
  ['Consulta', ['EN_ESPERA_CONSULTA', 'LLAMADO_CONSULTA', 'EN_CONSULTA']],
  ['Alta', ['ATENDIDO']],
];

export const PRIO = {
  CRITICA: ['Crítica', 'crit'],
  PRIORITARIA: ['Prioritaria', 'warn'],
  NORMAL: ['Normal', 'mut'],
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
];

export const DESTINOS = ['Alta', 'Reposo médico', 'Derivación a hospital'];

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
