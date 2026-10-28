/**
 * Cuentas de demostración del prototipo. Son las mismas que crean schema.sql y las actualizaciones v1.2 y v1.3
 * en Supabase, todas con la contraseña DEMO_PASSWORD. El inicio de sesión las ofrece como acceso de un clic
 * (ACCESO_DEMO) y la semilla las usa para generar la historia de demostración.
 */
import { ACCESO_DEMO } from './constants.js';

export const DEMO_USERS = [
  { u: 'a.admision', n: 'Carla Vidal (demo)', role: 'adm', col: '', on: true },
  { u: 'c.caja', n: 'Rocío Tello (demo)', role: 'caj', col: '', on: true },
  { u: 'e.triaje', n: 'Pedro Luna (demo)', role: 'enf', col: 'CEP-00000', on: true },
  { u: 'm.consulta', n: 'Dra. Elena Ríos (demo)', role: 'med', col: 'CMP-00000', on: true, esp: 'MG' },
  { u: 'm.consulta2', n: 'Dr. Luis Paz (demo)', role: 'med', col: 'CMP-00001', on: true, esp: 'MG' },
  { u: 'm.pediatria', n: 'Dra. Sofía Mora (demo)', role: 'med', col: 'CMP-00002', on: true, esp: 'PED' },
  { u: 'm.cardio', n: 'Dr. Raúl Vega (demo)', role: 'med', col: 'CMP-00003', on: true, esp: 'CAR' },
  { u: 'm.general3', n: 'Dra. Patricia Núñez (demo)', role: 'med', col: 'CMP-00004', on: true, esp: 'MG' },
  { u: 'm.pediatria2', n: 'Dr. Andrés Salas (demo)', role: 'med', col: 'CMP-00005', on: true, esp: 'PED' },
  { u: 'a.admision2', n: 'Jorge Huamán (demo)', role: 'adm', col: '', on: true },
  { u: 'c.caja2', n: 'Lucía Paredes (demo)', role: 'caj', col: '', on: true },
  { u: 'e.triaje2', n: 'Ana Quispe (demo)', role: 'enf', col: 'CEP-00002', on: true },
  { u: 'm.gineco', n: 'Dra. Carmen Salazar (demo)', role: 'med', col: 'CMP-00006', on: true, esp: 'GIN' },
  { u: 'm.general4', n: 'Dr. Hugo Medina (demo)', role: 'med', col: 'CMP-00007', on: true, esp: 'MG' },
  { u: 'a.admision3', n: 'Elsa Chávez (demo)', role: 'adm', col: '', on: true },
  { u: 'c.caja3', n: 'Martín Rojas (demo)', role: 'caj', col: '', on: true },
  { u: 'e.triaje3', n: 'Luis Vargas (demo)', role: 'enf', col: 'CEP-00003', on: true },
  { u: 'j.calidad', n: 'Silvia Torres (demo)', role: 'jef', col: '', on: true },
  { u: 'j.jefatura', n: 'Marco Soto (demo)', role: 'jef', col: '', on: true },
  // Resto de la cartera de primer nivel: medicina familiar e interna, materno-infantil, salud bucal, mental y nutrición
  { u: 'm.familiar', n: 'Dr. Ernesto Llanos (demo)', role: 'med', col: 'CMP-00013', on: true, esp: 'MF' },
  { u: 'm.interna', n: 'Dra. Liliana Pacheco (demo)', role: 'med', col: 'CMP-00014', on: true, esp: 'MI' },
  { u: 'm.obstetra', n: 'Obst. Milagros Cárdenas (demo)', role: 'med', col: 'COP-00001', on: true, esp: 'OBS' },
  { u: 'm.cred', n: 'Lic. Enf. Judith Arce (demo)', role: 'med', col: 'CEP-00006', on: true, esp: 'CRED' },
  { u: 'm.odonto', n: 'C.D. Renato Valdivia (demo)', role: 'med', col: 'COP-10001', on: true, esp: 'ODO' },
  { u: 'm.odonto2', n: 'C.D. Andrea Monzón (demo)', role: 'med', col: 'COP-10002', on: true, esp: 'ODO' },
  { u: 'm.psicologia', n: 'Ps. Diana Ugaz (demo)', role: 'med', col: 'CPsP-00001', on: true, esp: 'PSI' },
  { u: 'm.nutricion', n: 'Lic. Nut. Pablo Herrera (demo)', role: 'med', col: 'CNP-00001', on: true, esp: 'NUT' },
  { u: 'e.turno2', n: 'Iris Campos (demo)', role: 'enf', col: 'CEP-00001', on: false },
  // Autor de las citas que el paciente reserva por la web (no inicia sesión)
  { u: 'a.citasweb', n: 'Citas por web (sistema)', role: 'adm', col: '', on: false },
];


/** Cuentas que se ofrecen en el acceso rápido: las activas que pueden iniciar sesión. */
export const CUENTAS_RAPIDAS = DEMO_USERS.filter((u) => u.on && u.u !== 'a.citasweb');

/** Cuenta compartida del prototipo: no se le cambia la contraseña, para que el acceso rápido siga funcionando. */
export const esCuentaCompartida = (u) => ACCESO_DEMO && CUENTAS_RAPIDAS.some((x) => x.u === u);

/** Nombre para mostrar, sin la marca «(demo)». */
export const nombreCorto = (n) => n.replace(/\s*\(demo\)\s*$/, '');
