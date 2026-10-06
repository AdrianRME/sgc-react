/**
 * Movimiento compartido. Regla: se anima lo que cambió por una acción o por el flujo de pacientes
 * (un turno que avanza, una fila que se reordena, un diálogo que se abre), nunca como decoración.
 * MotionConfig reducedMotion="user" (main.jsx) desactiva los desplazamientos si el sistema lo pide.
 */
export const spring = { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 };
export const soft = { type: 'spring', stiffness: 260, damping: 30 };
export const quick = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] };

/** Entrada/salida de un elemento de lista (filas de cola, avisos, chips). */
export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, x: -16, transition: quick },
};

/** Cambio de sección dentro de un espacio. */
export const page = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12 } },
};

/** Diálogos y paneles flotantes. */
export const pop = {
  initial: { opacity: 0, scale: 0.96, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.98, y: 6, transition: quick },
};
export const fade = { initial: { opacity: 0 }, animate: { opacity: 1, transition: quick }, exit: { opacity: 0, transition: quick } };
