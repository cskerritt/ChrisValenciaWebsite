// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE_URL drives every absolute URL (canonical, OG image, sitemap, JSON-LD).
// Railway sets it to the generated domain until the real domain is purchased.
export default defineConfig({
  site: process.env.SITE_URL || 'https://chrisvalenciatattoo.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
});
