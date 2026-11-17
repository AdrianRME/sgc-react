/**
 * Movimiento compartido: TODAS las animaciones de Motion del sistema salen de este archivo (las de CSS con
 * @keyframes están en styles/motion.css). Ninguna pantalla define sus propios valores.
 *
 * Regla: se anima lo que cambió por una acción o por el flujo de pacientes (un turno que avanza, una fila que
 * se reordena, un grupo que se abre), nunca como decoración.
 * MotionConfig reducedMotion="user" (main.jsx) desactiva los desplazamientos si el sistema lo pide.
 */

/* ---------- Curvas y tiempos ---------- */
export const ease = [0.2, 0.8, 0.2, 1]; // la misma curva que --ease en tokens.css
export const spring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 };
export const soft = { type: 'spring', stiffness: 260, damping: 30 };
export const quick = { duration: 0.18, ease };

/* ---------- Entradas y salidas generales ---------- */

/** Fundido simple (velos de fondo). */
export const fade = { initial: { opacity: 0 }, animate: { opacity: 1, transition: quick }, exit: { opacity: 0, transition: quick } };

/**
 * Cambio de sección dentro de un espacio: se pasa la hoja del expediente (la anterior sale hacia el lomo y la
 * nueva entra desde la derecha). Solo desplazamiento y opacidad: al terminar no queda ninguna transformación,
 * porque una transformación en la vista descolocaría los diálogos, que se fijan a la pantalla.
 */
export const page = {
  initial: { opacity: 0, x: 34 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.34, ease } },
  exit: { opacity: 0, x: -24, transition: { duration: 0.14 } },
};

/** Primera aparición de un bloque principal (formulario de ingreso). */
export const entrada = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: soft } };

/** Diálogos y paneles flotantes: una hoja que se saca del archivador (sube un poco ladeada y se asienta). */
export const pop = {
  initial: { opacity: 0, y: 36, rotate: -1.4, scale: 0.98 },
  animate: { opacity: 1, y: 0, rotate: 0, scale: 1, transition: soft },
  exit: { opacity: 0, y: 20, scale: 0.98, transition: quick },
};

/** Aviso emergente: entra y sale por la derecha. */
export const aviso = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0, transition: spring },
  exit: { opacity: 0, x: 32, transition: quick },
};

/* ---------- Listas ---------- */

/** Entrada/salida de un elemento de lista (filas de cola, avisos, chips). */
export const listItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, x: -12, transition: quick },
};

/** Tarjeta que cambia de columna (flujo en vivo). */
export const tarjeta = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: spring,
};

/** Contenido de un grupo del acordeón: se despliega hacia abajo. */
export const plegar = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { height: { duration: 0.24, ease }, opacity: { duration: 0.2, delay: 0.04 } } },
  exit: { height: 0, opacity: 0, transition: { height: { duration: 0.18, ease }, opacity: { duration: 0.1 } } },
};

/* ---------- Cambios de valor ---------- */

/** Un valor que se reemplaza por otro en el mismo sitio (prioridad calculada, contador de avisos, ícono del área). */
export const cambio = {
  initial: { opacity: 0, scale: 0.7 },
  animate: { opacity: 1, scale: 1, transition: spring },
  exit: { opacity: 0, scale: 0.7, transition: quick },
};

/** Nota breve que aparece junto a un campo (estado de un signo vital, paso de la simulación). */
export const nota = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: quick },
  exit: { opacity: 0, transition: quick },
};

/* ---------- Pantalla de sala ---------- */

/** El llamado vigente cambia: el nuevo sube desde abajo. */
export const llamado = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: soft },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Aviso a pantalla completa de un llamado nuevo. */
export const pantalla = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: soft },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

/** Turno que entra o sale de la fila de una estación. */
export const fila = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
  transition: spring,
};
