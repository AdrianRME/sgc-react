import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import '@fontsource-variable/onest';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/shell.css';
import App from './App.jsx';
import { applyStoredTheme } from './hooks/useTheme.js';

applyStoredTheme();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* reducedMotion="user": si el sistema pide menos movimiento, solo se conservan los fundidos */}
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domMax} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  </StrictMode>,
);
