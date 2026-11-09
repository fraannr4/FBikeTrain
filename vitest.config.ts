import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      // Margen para máquinas cargadas y CI: varias pruebas de UI fallaban solo por tiempo.
      testTimeout: 15_000,
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  }),
);
