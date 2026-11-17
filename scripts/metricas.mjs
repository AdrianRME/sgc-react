/**
 * Métricas de calidad que se calculan contando sobre el propio proyecto (ISO/IEC 9126).
 * Uso:  npm run metricas
 *
 * Las demás métricas de las diapositivas salen de otras fuentes:
 *   - pruebas superadas ............ npm test
 *   - controles, choques, tiempos .. pruebas-carga/resultados (ver su README)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const leer = (f) => readFileSync(f, 'utf8');
const recorrer = (dir) => readdirSync(dir).flatMap((n) => {
  const f = join(dir, n);
  return statSync(f).isDirectory() ? recorrer(f) : [f];
});
const rel = (f) => relative(raiz, f).split(sep).join('/');
const dec = (x) => x.toFixed(2).replace('.', ',');
const titulo = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

const fuente = recorrer(join(raiz, 'src')).filter((f) => /\.(js|jsx)$/.test(f));
const pruebas = fuente.filter((f) => rel(f).includes('__tests__'));
const modulos = fuente.filter((f) => !pruebas.includes(f));

// ---------- Funcionalidad · Adecuación: escenarios de la ruta completados ----------
// Ejecuta los casos del simulador con las mismas reglas del sistema (src/store/actions.js) sobre una copia
// de prueba. Un paso cumple si hace lo que debe: avanza sin error o, si el sistema debe impedirlo, lo rechaza.
const { ESCENARIOS, crearSandbox, ejecutar, relojInicial } = await import('../src/lib/simulacion.js');
const reloj = relojInicial(new Date('2026-10-27T10:00:00').getTime()); // un martes: no depende del día en que se corre
const copia = crearSandbox(reloj);
let pasosOk = 0;
let pasosTotal = 0;
titulo('Funcionalidad · Adecuación: escenarios de la ruta completados');
const completos = ESCENARIOS.filter((esc) => {
  let fotos = [];
  try {
    fotos = ejecutar(esc, copia, reloj);
  } catch {
    /* un caso que se interrumpe cuenta como no completado */
  }
  const bien = fotos.filter((f) => (f.paso.rechazo || f.paso.falla ? !!f.error : !f.error)).length;
  const fin = fotos.at(-1)?.turno?.state;
  const ok = fotos.length === esc.pasos.length && bien === fotos.length && ['ATENDIDO', 'CANCELADO'].includes(fin);
  pasosOk += bien;
  pasosTotal += esc.pasos.length;
  console.log(`  ${ok ? 'CUMPLE' : 'FALLA '}  ${esc.titulo}: ${bien} de ${esc.pasos.length} pasos, termina ${fin ?? 'sin terminar'}`);
  return ok;
}).length;
console.log(`  X = escenarios completados / escenarios = ${completos} / ${ESCENARIOS.length} = ${dec(completos / ESCENARIOS.length)}`);
console.log(`  ${pasosOk} de ${pasosTotal} pasos cumplen (incluye los rechazos que el sistema debe hacer)`);

// ---------- Mantenibilidad · Analizabilidad: densidad de comentarios ----------
const lineas = modulos.reduce((s, f) => s + leer(f).split('\n').length, 0);
const comentarios = modulos.reduce((s, f) => s + (leer(f).match(/^\s*(?:\/\/|\/\*|\*)/gm) || []).length, 0);
titulo('Mantenibilidad · Analizabilidad: densidad de comentarios');
console.log(`  X = líneas de comentario / líneas de código = ${comentarios} / ${lineas} = ${dec(comentarios / lineas)}`);
console.log(`  ${modulos.length} módulos, ${Math.round(lineas / modulos.length)} líneas por módulo en promedio`);

// ---------- Mantenibilidad · Capacidad de prueba: lógica con pruebas ----------
const logica = modulos.filter((f) => rel(f).startsWith('src/lib/'));
titulo('Mantenibilidad · Capacidad de prueba: lógica con pruebas');
console.log(`  X = archivos de prueba / módulos de lógica = ${pruebas.length} / ${logica.length} = ${dec(pruebas.length / logica.length)}`);
console.log('  Los casos de prueba se ejecutan y se cuentan con: npm test');

// ---------- Usabilidad · Facilidad de aprendizaje: secciones con ayuda integrada ----------
// Cada sección del menú y el archivo de su pantalla; tiene ayuda si usa el botón «Cómo trabajar aquí»
const SECCIONES = {
  'Admisión · Ventanilla': 'views/Admision.jsx', 'Admisión · Asignar citas': 'views/Citas.jsx',
  'Admisión · Agenda de citas': 'views/Citas.jsx', 'Admisión · Flujo en vivo': 'views/Flujo.jsx',
  'Caja · Cobros': 'views/Caja.jsx', 'Enfermería · Lista de triaje': 'views/Triaje.jsx',
  'Consulta · Mis pacientes': 'views/Consulta.jsx', 'Consulta · Historias clínicas': 'views/Historias.jsx',
  'Jefatura · Tablero gerencial': 'views/jefatura/Tablero.jsx', 'Jefatura · Flujo en vivo': 'views/Flujo.jsx',
  'Jefatura · Usuarios': 'views/jefatura/Usuarios.jsx', 'Jefatura · Horarios médicos': 'views/jefatura/Horarios.jsx',
  'Jefatura · Auditoría': 'views/jefatura/Auditoria.jsx', 'Jefatura · Umbrales clínicos': 'views/jefatura/Umbrales.jsx',
};
const conAyuda = Object.entries(SECCIONES).map(([n, f]) => [n, /<Help\b|<WorkspaceHeader\b/.test(leer(join(raiz, 'src', f)))]);
const si = conAyuda.filter(([, ok]) => ok).length;
titulo('Usabilidad · Facilidad de aprendizaje: secciones con ayuda integrada');
console.log(`  X = secciones con guía de pasos / secciones = ${si} / ${conAyuda.length} = ${dec(si / conAyuda.length)}`);
conAyuda.filter(([, ok]) => !ok).forEach(([n]) => console.log(`  falta: ${n}`));

// ---------- Eficiencia · Utilización de recursos: código descargado al inicio ----------
titulo('Eficiencia · Utilización de recursos: código descargado al inicio');
const dist = join(raiz, 'dist', 'assets');
if (existsSync(dist)) {
  const js = readdirSync(dist).filter((n) => n.endsWith('.js')).map((n) => [n, statSync(join(dist, n)).size]);
  const total = js.reduce((s, [, t]) => s + t, 0);
  const [nombre, inicial] = js.filter(([n]) => n.startsWith('index-')).sort((a, b) => b[1] - a[1])[0] ?? ['—', 0];
  const kb = (b) => `${Math.round(b / 1000)} kB`;
  console.log(`  X = código inicial / código total = ${kb(inicial)} / ${kb(total)} = ${dec(inicial / total)}`);
  console.log(`  archivo inicial: ${nombre}; el resto son ${js.length - 1} archivos que se descargan por rol`);
} else {
  console.log('  Ejecute primero «npm run build» para generar la carpeta dist.');
}
console.log('');
