/**
 * JSON-LD builders. Every exported builder returns a plain object with
 * `@context` so it can be dropped straight into <JsonLd data={...} />.
 *
 * Facts come from `src/data/shop.json` (the single source of truth) and from
 * the portfolio manifest. Nothing here invents hours, prices or ratings:
 * opening hours carry only the verified days, and there is no priceRange.
 */

import shop from '../data/shop.json';
import { absoluteUrl, SITE_NAME } from './seo';

export const SCHEMA_CONTEXT = 'https://schema.org';

export type JsonLdNode = Record<string, unknown>;
export type JsonLd = JsonLdNode & { '@context': string; '@type': string };

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface HowToStep {
  name: string;
  text: string;
}

export interface PortfolioEntry {
  id: string;
  file: string;
  width: number;
  height: number;
  title: string;
  style: string[];
  placement: string;
  alt: string;
  featured?: boolean;
}

export const PERSON_ID = absoluteUrl('/#person');
export const WEBSITE_ID = absoluteUrl('/#website');
export const PARLOR_ID = `${shop.shop.url.replace(/\/$/, '')}/#tattooparlor`;

const STYLE_LABELS: Record<string, string> = {
  illustrative: 'Illustrative tattoos',
  'neo-traditional': 'Neo-traditional tattoos',
  'new-school': 'New-school tattoos',
  'cover-up': 'Cover-up tattoos',
  blackwork: 'Blackwork tattoos',
  color: 'Color tattoos',
};

export function styleLabel(key: string): string {
  return STYLE_LABELS[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)} tattoos`;
}

/** "a, b and c" */
function listWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function withContext<T extends JsonLdNode & { '@type': string }>(node: T): JsonLd {
  return { '@context': SCHEMA_CONTEXT, ...node };
}

function postalAddress(): JsonLdNode {
  const s = shop.shop;
  return {
    '@type': 'PostalAddress',
    streetAddress: s.streetAddress,
    addressLocality: s.addressLocality,
    addressRegion: s.addressRegion,
    postalCode: s.postalCode,
    addressCountry: 'US',
  };
}

function parlorNode(): JsonLdNode & { '@type': string } {
  const s = shop.shop;
  return {
    '@type': 'TattooParlor',
    '@id': PARLOR_ID,
    name: s.name,
    url: s.url,
    telephone: s.telephone,
    email: s.email,
    address: postalAddress(),
    geo: {
      '@type': 'GeoCoordinates',
      latitude: s.latitude,
      longitude: s.longitude,
    },
    hasMap: `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`,
    // Verified: open Monday–Saturday, by appointment only. Clock hours are not
    // known, so opens/closes are deliberately absent.
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [...s.days],
    },
  };
}

/** Compact reference to Chris for nesting inside other nodes. */
function personRef(): JsonLdNode {
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: shop.artist.name,
    url: absoluteUrl('/'),
  };
}

function personNode(): JsonLdNode & { '@type': string } {
  const a = shop.artist;
  const s = shop.shop;
  return {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: a.name,
    jobTitle: 'Tattoo Artist',
    description: `Tattoo artist working in ${listWithAnd(a.specialties)} styles at ${s.name} in ${s.addressLocality}, Rhode Island.`,
    url: absoluteUrl('/'),
    image: absoluteUrl(a.headshot),
    sameAs: [a.instagram],
    knowsAbout: a.specialties.map(styleLabel),
    worksFor: parlorNode(),
    address: postalAddress(),
  };
}

/** Chris Valencia as a schema.org Person, employed by the parlor. */
export function person(): JsonLd {
  return withContext(personNode());
}

/** Powerline Tattoo as a schema.org TattooParlor (LocalBusiness subtype). */
export function tattooParlor(): JsonLd {
  return withContext(parlorNode());
}

/** The site itself; emitted on every page by Base.astro. */
export function webSite(): JsonLd {
  return withContext({
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: absoluteUrl('/'),
    inLanguage: 'en-US',
    about: personRef(),
    publisher: personRef(),
  });
}

export interface FaqPageOptions {
  /** CSS selector(s) for the answers marked up as speakable, e.g. ".speakable". */
  speakable?: string | string[];
  /** Absolute or site-relative URL of the page carrying the FAQ. */
  path?: string;
}

/** FAQPage with one Question/Answer pair per item. */
export function faqPage(items: FaqItem[], opts: FaqPageOptions = {}): JsonLd {
  const node: JsonLdNode & { '@type': string } = {
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: a,
      },
    })),
  };
  if (opts.path) node.url = absoluteUrl(opts.path);
  if (opts.speakable) {
    node.speakable = {
      '@type': 'SpeakableSpecification',
      cssSelector: Array.isArray(opts.speakable) ? opts.speakable : [opts.speakable],
    };
  }
  return withContext(node);
}

export interface HowToOptions {
  description?: string;
  /** ISO 8601 duration, only when it is actually known. */
  totalTime?: string;
  path?: string;
}

/** HowTo with numbered HowToStep entries (aftercare). */
export function howTo(name: string, steps: HowToStep[], opts: HowToOptions = {}): JsonLd {
  const node: JsonLdNode & { '@type': string } = {
    '@type': 'HowTo',
    name,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  };
  if (opts.description) node.description = opts.description;
  if (opts.totalTime) node.totalTime = opts.totalTime;
  if (opts.path) node.url = absoluteUrl(opts.path);
  return withContext(node);
}

/** "Rhode Island" is the state; everything else in the mesh is a city/town. */
function areaNode(name: string): JsonLdNode {
  if (/^rhode island$/i.test(name.trim())) {
    return { '@type': 'State', name: 'Rhode Island' };
  }
  return {
    '@type': 'City',
    name,
    containedInPlace: { '@type': 'State', name: 'Rhode Island' },
  };
}

/** A tattoo style offered by Chris, served across the listed areas. */
export function service(
  name: string,
  description: string,
  areaServed: readonly string[],
  path: string,
): JsonLd {
  return withContext({
    '@type': 'Service',
    name,
    serviceType: name,
    description,
    url: absoluteUrl(path),
    provider: personRef(),
    areaServed: areaServed.map(areaNode),
    availableAtOrFrom: { '@id': PARLOR_ID, '@type': 'TattooParlor', name: shop.shop.name },
  });
}

function imageNode(entry: PortfolioEntry): JsonLdNode & { '@type': string } {
  const pageUrl = absoluteUrl(`/portfolio/#${entry.id}`);
  return {
    '@type': 'ImageObject',
    '@id': pageUrl,
    name: entry.title,
    description: entry.alt,
    contentUrl: absoluteUrl(entry.file),
    url: pageUrl,
    width: entry.width,
    height: entry.height,
    keywords: entry.style.map(styleLabel).join(', '),
    creator: personRef(),
    copyrightHolder: personRef(),
    creditText: shop.artist.name,
    representativeOfPage: entry.featured === true,
  };
}

/** One portfolio piece as an ImageObject. */
export function imageObject(entry: PortfolioEntry): JsonLd {
  return withContext(imageNode(entry));
}

/** An ItemList of ImageObjects for the portfolio page. */
export function imageList(entries: PortfolioEntry[], name = 'Tattoo portfolio'): JsonLd {
  return withContext({
    '@type': 'ItemList',
    name,
    numberOfItems: entries.length,
    itemListElement: entries.map((entry, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: imageNode(entry),
    })),
  });
}

/** BreadcrumbList with absolute `item` URLs, positions 1..n. */
export function breadcrumbs(items: BreadcrumbItem[]): JsonLd {
  return withContext({
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  });
}
