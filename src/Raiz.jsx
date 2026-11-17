import { useEffect } from 'react';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import { activarLuz } from './lib/luz.js';
import App from './App.jsx';
import { useMovimiento } from './hooks/useMovimiento.js';

/**
 * Animaciones de Motion según la preferencia del equipo: sin elección siguen al sistema operativo
 * («user»: si pide menos movimiento solo quedan los fundidos); con el botón de animaciones se fuerzan.
 */
export function Raiz() {
  const { motionConfig } = useMovimiento();
  useEffect(() => activarLuz(), []);
  return (
    <MotionConfig reducedMotion={motionConfig}>
      <LazyMotion features={domMax} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  );
}
