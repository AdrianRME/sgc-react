import { Sparkles, ZapOff } from 'lucide-react';
import { useMovimiento } from '../hooks/useMovimiento.js';

/**
 * Activa o reduce las animaciones en este equipo (se recuerda). Muestra el estado actual: así, si el sistema
 * operativo pide reducir movimiento y las animaciones no se ven, se sabe por qué y se pueden activar.
 */
export function BotonAnimaciones({ className = 'icon-btn', conTexto = true }) {
  const { reducido, alternar } = useMovimiento();
  const accion = reducido ? 'Activar animaciones' : 'Reducir animaciones';
  return (
    <button type="button" className={className} onClick={alternar} aria-pressed={!reducido} aria-label={accion} title={accion}>
      {reducido ? <ZapOff aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {conTexto && <span>{reducido ? 'Animaciones: no' : 'Animaciones: sí'}</span>}
    </button>
  );
}
