import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Frontend test framework (docs/frontend-handoff-v1.0 P0 "Frontend test
// infrastructure" / docs/v2.0-engineering-specs Sprint Plan v2.1 §6).
// Choice: Vitest + React Testing Library + jsdom, picked after the
// repository audit (no existing Jest/Vitest config to inherit) —
// Vitest was chosen over Jest because this is a Next.js 14 App Router +
// TypeScript(ESM) project with zero existing Jest config to build on;
// Vitest's native ESM/TS support and Vite-based transform avoid the
// ts-jest/babel-jest configuration Jest would need here. resolve.
// tsconfigPaths reuses the app's own tsconfig "@/*" alias natively
// instead of a separate moduleNameMapper or a plugin dependency. The
// backend (backend/) keeps its existing, working Jest setup unchanged —
// this is scoped to the frontend workspace only.
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
    exclude: ['node_modules', '.next', 'e2e/**'],
  },
});
