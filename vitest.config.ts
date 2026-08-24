/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// getViteConfig loads astro.config.mjs so unit tests see the same Vite
// environment as the site (import.meta.env.SITE, JSON imports, path aliases).
export default getViteConfig({
  test: {
    include: ['tests/unit/**/*.test.{js,ts}'],
    environment: 'node',
  },
});
