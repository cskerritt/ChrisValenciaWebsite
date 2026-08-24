/**
 * /robots.txt — everything public is crawlable (including by AI search
 * crawlers, which is the point of the site); the JSON API is not a page.
 * The sitemap URL is absolute and follows SITE_URL, like every other
 * absolute URL on the site.
 */
import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/seo';

export const GET: APIRoute = () => {
  const body = [
    '# Chris Valencia Tattoo',
    `# Summary for AI assistants: ${absoluteUrl('/llms.txt')}`,
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${absoluteUrl('/sitemap-index.xml')}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
