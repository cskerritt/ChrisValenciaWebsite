/**
 * /llms.txt — a plain-Markdown summary of the site for AI assistants and
 * answer engines (https://llmstxt.org). Built statically from the same
 * sources as the pages: src/data/shop.json, src/data/portfolio.json and the
 * content collections, so it can never drift from the site or state a fact
 * the site does not. Anything unconfirmed (rates, deposit amount,
 * availability) is described as "confirmed when you book", exactly as on the
 * pages.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import shop from '../data/shop.json';
import portfolio from '../data/portfolio.json';
import { absoluteUrl, SITE_NAME, INFO_PAGES } from '../lib/seo';
import { styleLabel } from '../lib/schema';

const byOrder = <T extends { data: { order: number } }>(a: T, b: T) => a.data.order - b.data.order;

export const GET: APIRoute = async () => {
  const [styles, locations, faq] = await Promise.all([
    getCollection('styles'),
    getCollection('locations'),
    getCollection('faq'),
  ]);
  styles.sort(byOrder);
  locations.sort(byOrder);
  faq.sort(byOrder);

  const { artist, shop: s } = shop;
  const url = (path: string) => absoluteUrl(path);
  const days = `${s.days[0]} through ${s.days[s.days.length - 1]}`;
  const featured = portfolio.filter((p) => p.featured);
  const pageDescriptions: Record<string, string> = {
    '/portfolio/': `All ${portfolio.length} pieces with descriptions, filterable by style.`,
    '/about/': 'Bio, the shop, a short video, Instagram.',
    '/faq/': 'Booking, pricing, process, aftercare and location questions, answered first.',
    '/pricing/': 'How a quote is built (size, placement, detail, color, sessions) and how the deposit works. No dollar figures.',
    '/aftercare/': 'Step-by-step healing instructions and when to contact the shop.',
    '/book/': 'The booking request form. Idea, placement, size, budget range, timing, reference images.',
  };

  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    `> ${artist.name} is a tattoo artist working in illustrative, neo-traditional and new-school styles. He is the resident artist at ${s.name}, ${s.streetAddress}, ${s.addressLocality}, ${s.addressRegion} ${s.postalCode}. The shop is open ${days}, by appointment only. Booking requests go through the form at ${url('/book/')}.`,
    '',
    'This file summarizes the site for AI assistants and search engines. Everything in it matches the pages, and nothing is stated that has not been confirmed. Where a detail is not published (rates, deposit amount, availability), the honest answer is "confirmed when you book".',
    '',
    '## Who',
    '',
    `- Name: ${artist.name}`,
    `- Role: tattoo artist; resident artist at ${s.name} in ${s.addressLocality}, Rhode Island`,
    '- Styles: works all styles, and prefers illustrative, neo-traditional and new-school',
    '- What he draws: fun, surreal images with a very animated, whimsical feel; animals with personality, botanicals, pet portraits, cartoon characters, objects doing things they should not; color and black-and-grey both',
    '- Background: born and raised in a small West Texas town, where he tattooed for about eight years; moved to the Atlanta, Georgia area about ten years ago; now tattooing full-time in Rhode Island',
    `- Instagram: ${artist.instagram} (${artist.instagramHandle})`,
    `- Video: ${artist.video}`,
    `- Headshot: ${url(artist.headshot)}`,
    '',
    '## Where',
    '',
    `- Shop: ${s.name}, ${s.url}`,
    `- Address: ${s.streetAddress}, ${s.addressLocality}, ${s.addressRegion} ${s.postalCode}, United States`,
    `- Phone: ${s.telephoneDisplay} (${s.telephone})`,
    `- Email: ${s.email}`,
    `- Hours: ${days}, ${s.hoursNote.toLowerCase()}`,
    `- Coordinates: ${s.latitude}, ${s.longitude}`,
    `- Map: https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`,
    '- Getting there: on Route 2 (Reservoir Avenue) near the southern end of Route 10, about ten minutes from downtown Providence',
    '- Parking: street and lot parking near the shop; confirm the details when booking',
    '- Walk-ins: the shop is appointment-only; ask about same-week openings through the booking form',
    '',
    '## How to book',
    '',
    `1. Send a request at ${url('/book/')} with your idea, placement, approximate size, budget range, timing and up to five reference images.`,
    '2. Chris replies by email to talk through the design, size and placement. Cover-ups and large pieces need an in-person consultation; some consultations happen over email with reference photos.',
    '3. A deposit is required to hold the appointment. The amount and the terms are confirmed when you book.',
    '4. The price is quoted at the consultation. It depends on size, placement, level of detail, color versus black-and-grey, and how many sessions the piece needs. No rates or minimums are published.',
    '5. Minimum age is 18 with a valid government-issued photo ID. Rhode Island sets the minimum age at eighteen and parental consent does not change it.',
    `6. Prefer to talk? Call ${s.name} at ${s.telephoneDisplay} or message ${artist.instagramHandle} on Instagram.`,
    '',
    '## Pages',
    '',
    `- [Home](${url('/')}): who Chris is, featured work, how booking works.`,
    ...INFO_PAGES.map((p) => `- [${p.name}](${url(p.path)}): ${pageDescriptions[p.path] ?? ''}`.trimEnd()),
    '',
    '## Styles',
    '',
    ...styles.map(
      (e) =>
        `- [${styleLabel(e.data.portfolioStyle)}](${url(`/styles/${e.data.slug}/`)}): ${e.data.tagline} ${e.data.description}`,
    ),
    '',
    '## Service area',
    '',
    `The shop is in ${s.addressLocality}, Rhode Island. Clients drive in from across the state and from nearby Massachusetts and Connecticut. Each location page has the route, an approximate drive time and local landmarks:`,
    '',
    ...locations.map((e) => `- [${e.data.city}](${url(`/tattoo-artist/${e.data.slug}/`)}): ${e.data.driveLabel}`),
    '',
    '## Portfolio',
    '',
    `${portfolio.length} pieces at ${url('/portfolio/')}, each with a written description. Featured pieces:`,
    '',
    ...featured.map(
      (p) => `- ${p.title} (${p.style.map((k) => styleLabel(k).replace(/ tattoos$/, '').toLowerCase()).join(', ')}; ${p.placement.toLowerCase()}): ${url(p.file)}`,
    ),
    '',
    '## Frequently asked questions',
    '',
    `Full answers at ${url('/faq/')}.`,
    '',
    ...faq.flatMap((e) => [`### ${e.data.question}`, '', e.data.answer, '']),
    '## Not published, on purpose',
    '',
    '- Hourly rate and shop minimum: quoted at the consultation.',
    '- Deposit amount and reschedule terms: confirmed when you book.',
    '- Availability and wait times: given with real dates in the reply to a booking request.',
    '- Client reviews or testimonials: none are published on this site.',
    '',
    `Canonical: ${url('/llms.txt')} · Sitemap: ${url('/sitemap-index.xml')}`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
