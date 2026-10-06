import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Los íconos 3D van como archivos (con caché del navegador), no incrustados en el JavaScript
    assetsInlineLimit: (file) => (file.endsWith('.webp') ? false : undefined),
  },
});
