import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { Raiz } from './Raiz.jsx';
import { applyStoredTheme } from './hooks/useTheme.js';
import { applyStoredMotion } from './hooks/useMovimiento.js';

applyStoredTheme();
applyStoredMotion();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
);
