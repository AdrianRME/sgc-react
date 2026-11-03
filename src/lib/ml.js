/**
 * Aprendizaje automático (ML) del PMV v2: un bosque aleatorio de árboles de regresión, sin bibliotecas externas,
 * que se entrena en el navegador con los hechos anónimos de las últimas semanas (los mismos del tablero).
 *
 * Dos casos de uso:
 *  1. Espera del paciente (RF-14): minutos desde la llegada hasta que el médico lo llama (pago + triaje + consulta).
 *  2. Afluencia (RF-15): llegadas por día y hora para los próximos días.
 *
 * Cada caso se evalúa como se usaría: se entrena con los días anteriores y se mide el error en la última semana,
 * que el modelo no vio, frente a la regla que el sistema ya usaba (la línea base). Con datos ficticios, las cifras
 * muestran cómo funciona el método, no la precisión que tendría con datos reales.
 */
import { DAY, SIS_EXONERADO } from './constants.js';
import { startOfDay } from './format.js';
import { HORAS_AFLUENCIA, mean } from './analytics.js';

/* ---------- Bosque aleatorio ---------- */

/** Números pseudoaleatorios con semilla: el mismo entrenamiento da siempre el mismo modelo. */
function semilla(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const varianza = (ys) => {
  const m = mean(ys);
  return ys.reduce((a, y) => a + (y - m) ** 2, 0);
};

/** Árbol de regresión (CART): en cada nodo elige el corte que más reduce el error cuadrático. */
function arbol(X, y, idx, { profundidad, minHoja, mtry, rnd, importancia }) {
  const ys = idx.map((i) => y[i]);
  const hoja = { v: mean(ys) };
  if (profundidad === 0 || idx.length < 2 * minHoja) return hoja;
  const base = varianza(ys);
  if (base === 0) return hoja;
  const p = X[0].length;
  const feats = Array.from({ length: p }, (_, j) => j).sort(() => rnd() - 0.5).slice(0, mtry);
  let mejor = null;
  for (const j of feats) {
    const orden = [...idx].sort((a, b) => X[a][j] - X[b][j]);
    // Sumas acumuladas para evaluar todos los cortes en una pasada
    let sI = 0;
    let qI = 0;
    let sT = 0;
    let qT = 0;
    for (const i of orden) { sT += y[i]; qT += y[i] ** 2; }
    for (let k = 0; k < orden.length - 1; k++) {
      const yi = y[orden[k]];
      sI += yi;
      qI += yi * yi;
      const nI = k + 1;
      const nD = orden.length - nI;
      if (nI < minHoja || nD < minHoja || X[orden[k]][j] === X[orden[k + 1]][j]) continue;
      const sse = qI - (sI * sI) / nI + (qT - qI) - ((sT - sI) ** 2) / nD;
      if (!mejor || sse < mejor.sse) mejor = { sse, j, corte: (X[orden[k]][j] + X[orden[k + 1]][j]) / 2 };
    }
  }
  if (!mejor || mejor.sse >= base) return hoja;
  importancia[mejor.j] += base - mejor.sse;
  const izq = idx.filter((i) => X[i][mejor.j] <= mejor.corte);
  const der = idx.filter((i) => X[i][mejor.j] > mejor.corte);
  const opt = { profundidad: profundidad - 1, minHoja, mtry, rnd, importancia };
  return { j: mejor.j, corte: mejor.corte, izq: arbol(X, y, izq, opt), der: arbol(X, y, der, opt) };
}

const predecirArbol = (n, x) => (n.v !== undefined ? n.v : predecirArbol(x[n.j] <= n.corte ? n.izq : n.der, x));

/**
 * Entrena un bosque aleatorio: cada árbol ve una muestra con reemplazo de los datos y, en cada corte, solo
 * una parte de las variables; la predicción es el promedio de los árboles.
 */
export function entrenarBosque(X, y, { arboles = 40, profundidad = 7, minHoja = 5, mtry, seed = 7 } = {}) {
  if (!X.length) return null;
  const p = X[0].length;
  const rnd = semilla(seed);
  const importancia = new Array(p).fill(0);
  const bosque = [];
  for (let t = 0; t < arboles; t++) {
    const idx = Array.from({ length: X.length }, () => Math.floor(rnd() * X.length));
    bosque.push(arbol(X, y, idx, { profundidad, minHoja, mtry: mtry ?? Math.max(1, Math.ceil(p / 2)), rnd, importancia }));
  }
  const total = importancia.reduce((a, b) => a + b, 0) || 1;
  return {
    predecir: (x) => mean(bosque.map((n) => predecirArbol(n, x))),
    importancia: importancia.map((v) => v / total),
  };
}

export const mae = (pred, real) => mean(pred.map((p, i) => Math.abs(p - real[i])));

/* ---------- Caso 1: espera del paciente ---------- */

export const VARIABLES_ESPERA = ['Prioridad', 'Llegadas en esa hora', 'Paga en Caja', 'Hora de llegada', 'Día de la semana', 'Semana'];
const PRIO_NUM = { CRITICA: 0, PRIORITARIA: 1, NORMAL: 2 };

/** Espera total del hecho (minutos): pago, triaje y consulta. Sin la espera hasta una cita de otro día. */
const esperaDe = (f) => {
  const { espPago = 0, espTri, espMed } = f.dur;
  return espTri == null || espMed == null ? null : (espPago ?? 0) + espTri + espMed;
};

/** Llegadas por día y hora (clave: inicio de la hora), para la variable de carga. */
const cargaPorHora = (facts) => facts.reduce((m, f) => m.set(f.t0, (m.get(f.t0) || 0) + 1), new Map());

const filaEspera = (prio, carga, paga, t0, origen) => [
  PRIO_NUM[prio] ?? 2, carga, paga ? 1 : 0, new Date(t0).getHours(), new Date(t0).getDay(), Math.floor((startOfDay(t0) - origen) / (7 * DAY)),
];

/**
 * Caso 1. Entrena con los días anteriores a la última semana y evalúa en esa semana. La línea base es el promedio
 * de espera de la prioridad del paciente (lo que haría alguien que solo mira el historial). Para predecir a los
 * pacientes de hoy, el modelo final se vuelve a entrenar con todas las semanas.
 */
export function modeloEspera(facts, now) {
  const carga = cargaPorHora(facts);
  const datos = facts.filter((f) => f.state === 'ATENDIDO' && f.prio && esperaDe(f) != null && startOfDay(f.t0) < startOfDay(now));
  if (datos.length < 60) return null;
  const origen = startOfDay(Math.min(...datos.map((f) => f.t0)));
  const fila = (f) => filaEspera(f.prio, carga.get(f.t0), !SIS_EXONERADO.includes(f.sis), f.t0, origen);
  const corte = startOfDay(now) - 7 * DAY;
  const train = datos.filter((f) => f.t0 < corte);
  const test = datos.filter((f) => f.t0 >= corte);
  if (train.length < 40 || test.length < 10) return null;
  const m = entrenarBosque(train.map(fila), train.map(esperaDe));
  const real = test.map(esperaDe);
  const pred = test.map((f) => m.predecir(fila(f)));
  const porPrio = Object.fromEntries(Object.keys(PRIO_NUM).map((p) => [p, mean(train.filter((f) => f.prio === p).map(esperaDe)) ?? mean(train.map(esperaDe))]));
  const base = test.map((f) => porPrio[f.prio]);
  const final = entrenarBosque(datos.map(fila), datos.map(esperaDe));
  return {
    n: { train: train.length, test: test.length },
    mae: mae(pred, real), maeBase: mae(base, real), mediaReal: mean(real),
    puntos: test.map((f, i) => ({ real: real[i], pred: pred[i], prio: f.prio })),
    importancia: VARIABLES_ESPERA.map((n, j) => ({ n, v: final.importancia[j] })).sort((a, b) => b.v - a.v),
    /** Espera estimada para un turno de hoy: prioridad (o null si aún no pasó por triaje) y si paga en Caja. */
    predecir: ({ prio, paga, t0 }, cargaHoy) => final.predecir(filaEspera(prio ?? 'NORMAL', cargaHoy, paga, t0, origen)),
  };
}

/* ---------- Caso 2: afluencia por hora ---------- */

export const VARIABLES_AFLUENCIA = ['Promedio de 4 semanas', 'Misma hora, semana anterior', 'Hora', 'Día de la semana', 'Semana'];

/**
 * Caso 2. Para cada día y hora usa las llegadas del mismo día y hora en las semanas anteriores. La línea base
 * es la regla de RF-15 (el promedio de esas semanas); el bosque aprende además el efecto de la hora, del día y
 * de la tendencia. Se evalúa en la última semana y luego se prevén los próximos días.
 */
export function modeloAfluencia(facts, now, { dias = 6 } = {}) {
  const porDia = new Map();
  for (const f of facts) {
    const i = new Date(f.t0).getHours() - HORAS_AFLUENCIA[0];
    if (i < 0 || i >= HORAS_AFLUENCIA.length) continue;
    const d = startOfDay(f.t0);
    if (!porDia.has(d)) porDia.set(d, HORAS_AFLUENCIA.map(() => 0));
    porDia.get(d)[i]++;
  }
  if (porDia.size < 14) return null;
  const primero = Math.min(...porDia.keys());
  const llegadas = (d, i) => (d >= primero ? (porDia.get(d)?.[i] ?? 0) : null);
  const semanaAtras = (d, k) => startOfDay(d - k * 7 * DAY + DAY / 2);
  const fila = (d, i) => {
    const prev = [1, 2, 3, 4].map((k) => llegadas(semanaAtras(d, k), i)).filter((x) => x != null);
    if (!prev.length) return null;
    return [mean(prev), prev[0], HORAS_AFLUENCIA[i], new Date(d).getDay(), Math.floor((d - primero) / (7 * DAY))];
  };
  const hoy = startOfDay(now);
  const corte = hoy - 7 * DAY;
  const X = [];
  const y = [];
  const Xt = [];
  const yt = [];
  for (let d = startOfDay(primero + 7 * DAY + DAY / 2); d < hoy; d = startOfDay(d + DAY + DAY / 2)) {
    if (new Date(d).getDay() === 0) continue;
    HORAS_AFLUENCIA.forEach((_, i) => {
      const x = fila(d, i);
      if (!x) return;
      (d < corte ? X : Xt).push(x);
      (d < corte ? y : yt).push(llegadas(d, i));
    });
  }
  if (X.length < 60 || !Xt.length) return null;
  const m = entrenarBosque(X, y, { profundidad: 6, minHoja: 4 });
  const final = entrenarBosque([...X, ...Xt], [...y, ...yt], { profundidad: 6, minHoja: 4 });
  const proximos = [];
  for (let k = 0; proximos.length < dias && k < dias + 2; k++) {
    const d = startOfDay(hoy + k * DAY + DAY / 2);
    if (new Date(d).getDay() === 0) continue;
    const filas = HORAS_AFLUENCIA.map((_, i) => fila(d, i));
    proximos.push({ t: d, ml: filas.map((x) => (x ? final.predecir(x) : 0)), base: filas.map((x) => (x ? x[0] : 0)) });
  }
  return {
    n: { train: X.length, test: Xt.length },
    mae: mae(Xt.map((x) => m.predecir(x)), yt), maeBase: mae(Xt.map((x) => x[0]), yt), mediaReal: mean(yt),
    importancia: VARIABLES_AFLUENCIA.map((n, j) => ({ n, v: final.importancia[j] })).sort((a, b) => b.v - a.v),
    proximos,
  };
}
