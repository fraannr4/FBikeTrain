import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En GitHub Pages la web vive en /<nombre-repo>/. El workflow de despliegue
// pasa ese prefijo en BASE_PATH; en local se sirve desde la raíz.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    // Los agentes escriben en docs/, e2e/ y en informes mientras el servidor corre.
    // En Windows, vigilar ficheros bloqueados (p. ej. sh.exe.stackdump) tumba Vite con EBUSY.
    watch: { ignored: ['**/docs/**', '**/test-results/**', '**/playwright-report/**', '**/*.stackdump'] },
  },
});
