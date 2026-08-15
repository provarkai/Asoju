import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Restores the frontend test baseline the sprint plan calls for (see
 * docs/FRONTEND_HANDOFF_V1_GAP_MAP.md §5/§7) — Vitest + React Testing
 * Library + jsdom.
 *
 * Framework choice, recorded per the plan's own "select ... document the
 * selection and rationale" instruction: Vitest over Jest because this is
 * a Next.js 14 App Router project already on Vite-shaped tooling
 * elsewhere in the monorepo's conventions, has first-class ESM/TS support
 * with no transform config of its own, and reuses the exact
 * `vite-tsconfig`-free `@/*` alias already declared in tsconfig.json
 * below rather than needing a second babel/ts-jest pipeline next to the
 * backend's existing Jest setup. React Testing Library over
 * component-snapshot or Enzyme-style testing because these are Radix-
 * primitive-based components (button/input/textarea/badge/dialog, see
 * src/components/ui/) — RTL's queries exercise them the way a user
 * actually interacts with them (role, label, click), not their internal
 * structure, which is exactly what a design-system regression suite
 * needs and what Sprint 1 (frontend design-system) shipped without.
 *
 * This is a *second* test framework alongside the backend's Jest e2e
 * suite, not a replacement — the two run against different targets
 * (component/unit here, real-app-and-Postgres there) and gain nothing by
 * being unified.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
