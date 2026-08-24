/**
 * /robots.txt — everything public is crawlable (including by AI search
 * crawlers, which is the point of the site); the JSON API is not a page.
 * The sitemap URL is absolute and follows SITE_URL, like every other
 * absolute URL on the site.
 *
 * AI crawlers get explicit stanzas. A bot that matches a specific
 * `User-agent` group ignores the `*` group entirely, so each stanza
 * repeats the /api/ disallow rather than inheriting it.
 */
import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/seo';

/**
 * AI search / assistant / answer-engine crawlers, explicitly welcomed:
 * OpenAI (GPTBot trains, OAI-SearchBot powers ChatGPT search, ChatGPT-User
 * fetches on behalf of users), Anthropic (ClaudeBot, Claude-User,
 * Claude-SearchBot), Perplexity (PerplexityBot, Perplexity-User), Google
 * AI (Google-Extended), Apple Intelligence (Applebot-Extended), Meta AI
 * (meta-externalagent), and Common Crawl (CCBot), whose corpus feeds many
 * model training sets.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'CCBot',
] as const;

const group = (ua: string) => [`User-agent: ${ua}`, 'Allow: /', 'Disallow: /api/', ''];

export const GET: APIRoute = () => {
  const body = [
    '# Chris Valencia Tattoo',
    `# Summary for AI assistants: ${absoluteUrl('/llms.txt')}`,
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    '# AI search and assistant crawlers are explicitly welcome.',
    ...AI_CRAWLERS.flatMap(group),
    `Sitemap: ${absoluteUrl('/sitemap-index.xml')}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
