/**
 * SEO helpers + the site's route map.
 *
 * `absoluteUrl()` turns a site-relative path into an absolute URL using the
 * Astro `site` setting (driven by the SITE_URL env var, see astro.config.mjs).
 * The link lists below are the internal link mesh (every style page links all
 * locations, every location links all styles, the footer links everything)
 * and mirror the slugs of `src/content/styles` and `src/content/locations`.
 */

export const SITE_NAME = 'Chris Valencia Tattoo';
export const DEFAULT_OG_IMAGE = '/og-default.jpg';
export const DEFAULT_OG_IMAGE_ALT =
  'A tattoo by Chris Valencia, resident artist at Powerline Tattoo in Cranston, Rhode Island';
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

const FALLBACK_SITE = 'https://chrisvalenciatattoo.com';

function resolveSiteUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromAstro = env?.SITE;
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env.SITE_URL : undefined;
  const raw = (fromAstro || fromProcess || FALLBACK_SITE).trim();
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** Absolute site origin with a trailing slash, e.g. "https://chrisvalenciatattoo.com/". */
export const SITE_URL: string = resolveSiteUrl();

/**
 * Absolute URL for a site path. Already-absolute URLs (https:, mailto:, tel:)
 * pass through untouched.
 *
 *   absoluteUrl('/about/')   -> https://chrisvalenciatattoo.com/about/
 *   absoluteUrl('about/')    -> https://chrisvalenciatattoo.com/about/
 *   absoluteUrl('/#person')  -> https://chrisvalenciatattoo.com/#person
 */
export function absoluteUrl(path: string = '/'): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const rel = path.replace(/^\/+/, '');
  return new URL(rel, SITE_URL).href;
}

/**
 * Normalises a pathname for use as a canonical: leading slash, no query or
 * hash, trailing slash for directory routes (the site builds with
 * `trailingSlash: 'always'`). File-like paths ("/llms.txt") are left alone.
 */
export function canonicalPathFor(path: string = '/'): string {
  let p = (path || '/').split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  const last = p.slice(p.lastIndexOf('/') + 1);
  if (!p.endsWith('/') && !last.includes('.')) p += '/';
  return p;
}

/** Word-boundary truncation with a single ellipsis; never exceeds `max`. */
export function truncate(text: string, max: number = DESCRIPTION_MAX, ellipsis = '…'): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - ellipsis.length);
  const atWord = cut.lastIndexOf(' ');
  const base = atWord > max * 0.6 ? cut.slice(0, atWord) : cut;
  return `${base.replace(/[\s,;:.!?-]+$/, '')}${ellipsis}`;
}

/** Word count used by copy checks (answer-first paragraphs are 40–60 words). */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface SiteLink {
  name: string;
  path: string;
}

/** Style explainer pages (`src/content/styles/*.md`). */
export const STYLE_PAGES: readonly SiteLink[] = [
  { name: 'Illustrative', path: '/styles/illustrative/' },
  { name: 'Neo-traditional', path: '/styles/neo-traditional/' },
  { name: 'New-school', path: '/styles/new-school/' },
  { name: 'Cover-ups', path: '/styles/cover-ups/' },
];

/** Location pages (`src/content/locations/*.md`). Order = drive time from the shop. */
export const LOCATION_PAGES: readonly SiteLink[] = [
  { name: 'Cranston', path: '/tattoo-artist/cranston/' },
  { name: 'Providence', path: '/tattoo-artist/providence/' },
  { name: 'Warwick', path: '/tattoo-artist/warwick/' },
  { name: 'Johnston', path: '/tattoo-artist/johnston/' },
  { name: 'West Warwick', path: '/tattoo-artist/west-warwick/' },
  { name: 'East Providence', path: '/tattoo-artist/east-providence/' },
  { name: 'Pawtucket', path: '/tattoo-artist/pawtucket/' },
  { name: 'Rhode Island', path: '/tattoo-artist/rhode-island/' },
];

/** Area names for `service()` JSON-LD `areaServed`. */
export const SERVICE_AREAS: readonly string[] = LOCATION_PAGES.map((l) => l.name);

/** Informational pages linked from the footer. */
export const INFO_PAGES: readonly SiteLink[] = [
  { name: 'Portfolio', path: '/portfolio/' },
  { name: 'About Chris', path: '/about/' },
  { name: 'FAQ', path: '/faq/' },
  { name: 'Pricing', path: '/pricing/' },
  { name: 'Aftercare', path: '/aftercare/' },
  { name: 'Traveling In', path: '/travel/' },
  { name: 'Book', path: '/book/' },
];

/** Header navigation (Styles is a disclosure menu; Book is the CTA). */
export const PRIMARY_NAV: readonly SiteLink[] = [
  { name: 'Portfolio', path: '/portfolio/' },
  { name: 'About', path: '/about/' },
  { name: 'FAQ', path: '/faq/' },
];
