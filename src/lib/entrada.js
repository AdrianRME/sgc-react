/**
 * Cómo entra cada persona al prototipo, y el modo visita.
 *
 * Entrada: la portada pregunta «¿paciente o personal del centro?». El paciente va a «Mi atención»; el personal
 * confirma con el PIN del centro antes de ver el inicio de sesión. En este prototipo el PIN se muestra en
 * pantalla: es un paso de demostración, no una barrera (la seguridad real es la contraseña de cada cuenta).
 *
 * Modo visita: una copia completa del sistema con datos de demostración guardada solo en el navegador de
 * quien la abre. Se puede usar todo (registrar, cobrar, hacer triaje, atender) sin tocar la base real.
 */
export const PIN_CENTRO = '2026';

const ENTRADA = 'sgc-entrada';
const MODO = 'sgc-modo';

const leer = (store, k) => {
  try {
    return store.getItem(k);
  } catch {
    return null;
  }
};
const escribir = (store, k, v) => {
  try {
    if (v == null) store.removeItem(k);
    else store.setItem(k, v);
  } catch {
    /* sin almacenamiento: vale solo hasta recargar */
  }
};

/** ¿Ya confirmó en esta pestaña que es personal del centro? */
export const esPersonal = () => leer(sessionStorage, ENTRADA) === 'personal';
export const marcarPersonal = (si = true) => escribir(sessionStorage, ENTRADA, si ? 'personal' : null);

/** ¿Este navegador está en modo visita? (se elige al cargar la app: data/repo.js) */
export const enVisita = () => typeof window !== 'undefined' && leer(localStorage, MODO) === 'visita';

/** Entra o sale del modo visita. Recarga la app para cambiar de dónde salen los datos. */
export function entrarVisita() {
  escribir(localStorage, MODO, 'visita');
  marcarPersonal(true);
  window.location.hash = '#/';
  window.location.reload();
}
export function salirVisita() {
  escribir(localStorage, MODO, null);
  marcarPersonal(false);
  window.location.hash = '#/';
  window.location.reload();
}
