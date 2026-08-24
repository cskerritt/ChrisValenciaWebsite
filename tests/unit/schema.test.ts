import { describe, it, expect } from 'vitest';
import shop from '../../src/data/shop.json';
import portfolio from '../../src/data/portfolio.json';
import {
  absoluteUrl,
  canonicalPathFor,
  truncate,
  wordCount,
  SITE_URL,
  STYLE_PAGES,
  LOCATION_PAGES,
  SERVICE_AREAS,
} from '../../src/lib/seo';
import {
  person,
  tattooParlor,
  webSite,
  faqPage,
  howTo,
  service,
  imageObject,
  imageList,
  breadcrumbs,
  styleLabel,
  PERSON_ID,
  PARLOR_ID,
} from '../../src/lib/schema';

const CONTEXT = 'https://schema.org';
const isAbsolute = (u: unknown): boolean => typeof u === 'string' && /^https:\/\/[^/]+\//.test(u);

describe('absoluteUrl()', () => {
  it('SITE_URL is absolute https with a trailing slash', () => {
    expect(SITE_URL).toMatch(/^https:\/\/[^/]+\/$/);
  });

  it('joins site-relative paths with or without a leading slash', () => {
    expect(absoluteUrl('/about/')).toBe(`${SITE_URL}about/`);
    expect(absoluteUrl('about/')).toBe(`${SITE_URL}about/`);
    expect(absoluteUrl('/')).toBe(SITE_URL);
    expect(absoluteUrl()).toBe(SITE_URL);
  });

  it('keeps fragments and nested paths', () => {
    expect(absoluteUrl('/#person')).toBe(`${SITE_URL}#person`);
    expect(absoluteUrl('/portfolio/#chris-04')).toBe(`${SITE_URL}portfolio/#chris-04`);
    expect(absoluteUrl('/images/portfolio/chris-01.jpg')).toBe(`${SITE_URL}images/portfolio/chris-01.jpg`);
  });

  it('passes absolute URLs and non-http schemes through untouched', () => {
    expect(absoluteUrl('https://instagram.com/cvalencia7')).toBe('https://instagram.com/cvalencia7');
    expect(absoluteUrl('mailto:info@powerlinetattoo.com')).toBe('mailto:info@powerlinetattoo.com');
    expect(absoluteUrl('tel:+1-401-369-7771')).toBe('tel:+1-401-369-7771');
  });
});

describe('canonicalPathFor()', () => {
  it('adds a trailing slash to directory routes and strips query/hash', () => {
    expect(canonicalPathFor('/about')).toBe('/about/');
    expect(canonicalPathFor('/about/')).toBe('/about/');
    expect(canonicalPathFor('about')).toBe('/about/');
    expect(canonicalPathFor('/faq/?x=1#q')).toBe('/faq/');
    expect(canonicalPathFor('/')).toBe('/');
    expect(canonicalPathFor('')).toBe('/');
  });

  it('leaves file-like paths alone', () => {
    expect(canonicalPathFor('/llms.txt')).toBe('/llms.txt');
    expect(canonicalPathFor('/sitemap-index.xml')).toBe('/sitemap-index.xml');
  });
});

describe('truncate() / wordCount()', () => {
  it('returns short text unchanged and collapses whitespace', () => {
    expect(truncate('hello   world', 160)).toBe('hello world');
  });

  it('cuts at a word boundary, never exceeding max', () => {
    const long = 'Chris Valencia tattoos illustrative neo-traditional and new-school pieces at Powerline Tattoo in Cranston Rhode Island';
    const out = truncate(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('counts words', () => {
    expect(wordCount('  one two   three ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});

describe('route map', () => {
  it('lists the four style pages and eight location pages from the spec', () => {
    expect(STYLE_PAGES.map((s) => s.path)).toEqual([
      '/styles/illustrative/',
      '/styles/neo-traditional/',
      '/styles/new-school/',
      '/styles/cover-ups/',
    ]);
    expect(LOCATION_PAGES.map((l) => l.path)).toEqual([
      '/tattoo-artist/cranston/',
      '/tattoo-artist/providence/',
      '/tattoo-artist/warwick/',
      '/tattoo-artist/johnston/',
      '/tattoo-artist/west-warwick/',
      '/tattoo-artist/east-providence/',
      '/tattoo-artist/pawtucket/',
      '/tattoo-artist/rhode-island/',
    ]);
    expect(SERVICE_AREAS).toHaveLength(8);
    for (const link of [...STYLE_PAGES, ...LOCATION_PAGES]) {
      expect(link.path).toMatch(/^\/.+\/$/);
      expect(link.name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('person()', () => {
  const p = person();

  it('is a schema.org Person who works for a TattooParlor', () => {
    expect(p['@context']).toBe(CONTEXT);
    expect(p['@type']).toBe('Person');
    expect(p['@id']).toBe(PERSON_ID);
    expect(p.name).toBe('Chris Valencia');
    expect(p.jobTitle).toBe('Tattoo Artist');
    expect((p.worksFor as Record<string, unknown>)['@type']).toBe('TattooParlor');
    expect((p.worksFor as Record<string, unknown>).name).toBe('Powerline Tattoo');
  });

  it('links Instagram via sameAs and uses absolute image/url', () => {
    expect(p.sameAs).toContain('https://instagram.com/cvalencia7');
    expect(isAbsolute(p.url)).toBe(true);
    expect(isAbsolute(p.image)).toBe(true);
    expect(p.image).toBe(absoluteUrl(shop.artist.headshot));
  });

  it('lists specialties as knowsAbout and carries the parlor address', () => {
    expect(p.knowsAbout).toEqual([
      'Illustrative tattoos',
      'Neo-traditional tattoos',
      'New-school tattoos',
    ]);
    const addr = p.address as Record<string, unknown>;
    expect(addr['@type']).toBe('PostalAddress');
    expect(addr.addressLocality).toBe('Cranston');
    expect(addr.addressRegion).toBe('RI');
    expect(addr.postalCode).toBe('02910');
  });

  it('returns a fresh object each call (no shared mutation)', () => {
    const a = person();
    const b = person();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    (a.worksFor as Record<string, unknown>).name = 'mutated';
    expect((person().worksFor as Record<string, unknown>).name).toBe('Powerline Tattoo');
  });
});

describe('tattooParlor()', () => {
  const t = tattooParlor();

  it('has the verified NAP, geo and six opening days', () => {
    expect(t['@context']).toBe(CONTEXT);
    expect(t['@type']).toBe('TattooParlor');
    expect(t['@id']).toBe(PARLOR_ID);
    expect(t.name).toBe('Powerline Tattoo');
    expect(t.telephone).toBe('+1-401-369-7771');
    expect(t.email).toBe('info@powerlinetattoo.com');
    expect(t.url).toBe('https://powerlinetattoo.com');
    const geo = t.geo as Record<string, unknown>;
    expect(geo['@type']).toBe('GeoCoordinates');
    expect(geo.latitude).toBe(41.7721);
    expect(geo.longitude).toBe(-71.4352);
    const hours = t.openingHoursSpecification as Record<string, unknown>;
    expect(hours['@type']).toBe('OpeningHoursSpecification');
    expect(hours.dayOfWeek).toHaveLength(6);
    expect(hours.dayOfWeek).toEqual(shop.shop.days);
  });

  it('does not invent clock hours or a price range', () => {
    const hours = t.openingHoursSpecification as Record<string, unknown>;
    expect(hours).not.toHaveProperty('opens');
    expect(hours).not.toHaveProperty('closes');
    expect(t).not.toHaveProperty('priceRange');
    expect(t).not.toHaveProperty('aggregateRating');
  });
});

describe('webSite()', () => {
  it('names the site and points at the root', () => {
    const w = webSite();
    expect(w['@type']).toBe('WebSite');
    expect(w.name).toBe('Chris Valencia Tattoo');
    expect(w.url).toBe(SITE_URL);
    expect(w.inLanguage).toBe('en-US');
    expect((w.publisher as Record<string, unknown>)['@id']).toBe(PERSON_ID);
  });
});

describe('faqPage()', () => {
  const items = [
    { q: 'How do I book?', a: 'Use the booking form; Chris replies by email.' },
    { q: 'Where is the shop?', a: '706 Reservoir Avenue, Cranston, RI 02910.' },
  ];

  it('maps items to Question/acceptedAnswer.text', () => {
    const f = faqPage(items);
    expect(f['@context']).toBe(CONTEXT);
    expect(f['@type']).toBe('FAQPage');
    const main = f.mainEntity as Array<Record<string, unknown>>;
    expect(main).toHaveLength(2);
    expect(main[0]['@type']).toBe('Question');
    expect(main[0].name).toBe(items[0].q);
    expect((main[0].acceptedAnswer as Record<string, unknown>)['@type']).toBe('Answer');
    expect((main[0].acceptedAnswer as Record<string, unknown>).text).toBe(items[0].a);
    expect((main[1].acceptedAnswer as Record<string, unknown>).text).toBe(items[1].a);
    expect(f).not.toHaveProperty('speakable');
  });

  it('adds a SpeakableSpecification and page url when asked', () => {
    const f = faqPage(items, { speakable: '.speakable', path: '/faq/' });
    expect(f.speakable).toEqual({
      '@type': 'SpeakableSpecification',
      cssSelector: ['.speakable'],
    });
    expect(f.url).toBe(`${SITE_URL}faq/`);
  });
});

describe('howTo()', () => {
  it('numbers HowToStep entries from 1', () => {
    const h = howTo('Tattoo aftercare', [
      { name: 'Leave the wrap on', text: 'Follow the timing Chris gives you.' },
      { name: 'Wash gently', text: 'Fragrance-free soap, lukewarm water.' },
    ]);
    expect(h['@type']).toBe('HowTo');
    expect(h.name).toBe('Tattoo aftercare');
    const steps = h.step as Array<Record<string, unknown>>;
    expect(steps.map((s) => s.position)).toEqual([1, 2]);
    expect(steps[0]['@type']).toBe('HowToStep');
    expect(steps[1].name).toBe('Wash gently');
    expect(steps[1].text).toBe('Fragrance-free soap, lukewarm water.');
    expect(h).not.toHaveProperty('totalTime');
  });
});

describe('service()', () => {
  const s = service(
    'Neo-traditional tattoos',
    'Bold lines and saturated color with an illustrative twist.',
    SERVICE_AREAS,
    '/styles/neo-traditional/',
  );

  it('is provided by Chris with an absolute url', () => {
    expect(s['@type']).toBe('Service');
    expect(s.name).toBe('Neo-traditional tattoos');
    expect(s.url).toBe(`${SITE_URL}styles/neo-traditional/`);
    expect((s.provider as Record<string, unknown>)['@type']).toBe('Person');
    expect((s.provider as Record<string, unknown>)['@id']).toBe(PERSON_ID);
    expect((s.availableAtOrFrom as Record<string, unknown>)['@id']).toBe(PARLOR_ID);
  });

  it('types every area: cities inside Rhode Island, and the state itself', () => {
    const areas = s.areaServed as Array<Record<string, unknown>>;
    expect(areas).toHaveLength(8);
    const cities = areas.filter((a) => a['@type'] === 'City');
    const states = areas.filter((a) => a['@type'] === 'State');
    expect(cities).toHaveLength(7);
    expect(states).toEqual([{ '@type': 'State', name: 'Rhode Island' }]);
    expect(cities.map((c) => c.name)).toContain('Providence');
    for (const c of cities) {
      expect(c.containedInPlace).toEqual({ '@type': 'State', name: 'Rhode Island' });
    }
  });
});

describe('imageObject() / imageList()', () => {
  const entry = portfolio[0];

  it('describes a portfolio piece with absolute contentUrl and integer dimensions', () => {
    const i = imageObject(entry);
    expect(i['@type']).toBe('ImageObject');
    expect(i.contentUrl).toBe(absoluteUrl(entry.file));
    expect(isAbsolute(i.contentUrl)).toBe(true);
    expect(i.url).toBe(`${SITE_URL}portfolio/#${entry.id}`);
    expect(i.name).toBe(entry.title);
    expect(i.description).toBe(entry.alt);
    expect(i.width).toBe(entry.width);
    expect(i.height).toBe(entry.height);
    expect(Number.isInteger(i.width)).toBe(true);
    expect((i.creator as Record<string, unknown>).name).toBe('Chris Valencia');
    expect(i.keywords).toContain('tattoos');
  });

  it('wraps entries in a positioned ItemList', () => {
    const list = imageList(portfolio.slice(0, 3));
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(3);
    const els = list.itemListElement as Array<Record<string, unknown>>;
    expect(els.map((e) => e.position)).toEqual([1, 2, 3]);
    expect((els[2].item as Record<string, unknown>)['@type']).toBe('ImageObject');
    expect(els[2].item).not.toHaveProperty('@context');
  });

  it('labels every style key used in the manifest', () => {
    const keys = new Set(portfolio.flatMap((p) => p.style));
    for (const k of keys) expect(styleLabel(k)).toMatch(/tattoos$/);
  });
});

describe('breadcrumbs()', () => {
  it('positions items 1..n with absolute item URLs', () => {
    const b = breadcrumbs([
      { name: 'Home', path: '/' },
      { name: 'Styles', path: '/styles/neo-traditional/' },
      { name: 'Neo-traditional', path: '/styles/neo-traditional/' },
    ]);
    expect(b['@context']).toBe(CONTEXT);
    expect(b['@type']).toBe('BreadcrumbList');
    const els = b.itemListElement as Array<Record<string, unknown>>;
    expect(els.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(els.map((e) => e['@type'])).toEqual(['ListItem', 'ListItem', 'ListItem']);
    expect(els[0].item).toBe(SITE_URL);
    expect(els[2].item).toBe(`${SITE_URL}styles/neo-traditional/`);
    expect(els[2].name).toBe('Neo-traditional');
    for (const e of els) expect(isAbsolute(e.item)).toBe(true);
  });
});

describe('no invented facts anywhere in the graph', () => {
  const graph = JSON.stringify([
    person(),
    tattooParlor(),
    webSite(),
    service('Illustrative tattoos', 'Drawn-style tattoos.', SERVICE_AREAS, '/styles/illustrative/'),
    imageList(portfolio),
    breadcrumbs([{ name: 'Home', path: '/' }]),
  ]);

  it('contains no dollar amounts, year counts, ratings or clock hours', () => {
    expect(graph).not.toMatch(/\$\s?\d/);
    expect(graph).not.toMatch(/\b\d+\+?\s*(years?|yrs?)\b/i);
    expect(graph).not.toMatch(/"(opens|closes|priceRange|aggregateRating|ratingValue)"/);
  });

  it('serialises every builder with @context and @type', () => {
    for (const node of [person(), tattooParlor(), webSite(), faqPage([]), howTo('x', []), breadcrumbs([])]) {
      expect(node['@context']).toBe(CONTEXT);
      expect(typeof node['@type']).toBe('string');
    }
  });
});
