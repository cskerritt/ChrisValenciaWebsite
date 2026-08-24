import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Content collections: styles, locations, faq.
 *
 * Conventions shared by all three (read this before templating them):
 *
 * - `answer` is the 40–60 word answer-first paragraph that sits directly under
 *   the page H1 (styles/locations) or the question H2 (faq). It is NOT repeated
 *   inside the markdown body. Templates render `data.answer` first, then
 *   `<Content />`. FAQ pages should wrap `answer` in the speakable element and
 *   feed it to the FAQPage JSON-LD builder.
 * - `metaTitle` is the complete <title> (≤ 60 chars, branding included). Do not
 *   append a suffix to it. `description` is the meta description (120–160).
 * - `slug` always equals the file name; `entry.id` from the glob loader will
 *   match it. Either works for getStaticPaths.
 * - `h1` is the exact page heading. Use it instead of templating a heading
 *   string, so the statewide location page and the style pages read correctly.
 * - Bodies never contain an H1. Section headings are H2s phrased as questions;
 *   the paragraph right under each is a 40–60 word answer (checked in a script,
 *   not here, because zod does not see the body).
 *
 * The refinements below fail the build on a rule violation, which is the point.
 */

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const answerParagraph = z
  .string()
  .refine((s) => !/\n/.test(s.trim()), { message: 'answer must be a single paragraph' })
  .refine(
    (s) => {
      const n = wordCount(s);
      return n >= 40 && n <= 60;
    },
    { message: 'answer must be 40–60 words (answer-first paragraph)' },
  );

const metaTitle = z
  .string()
  .min(20, 'metaTitle too short')
  .max(60, 'metaTitle must be ≤ 60 characters');

const metaDescription = z
  .string()
  .min(120, 'description must be ≥ 120 characters')
  .max(160, 'description must be ≤ 160 characters');

/** Style keys as used in src/data/portfolio.json `style[]`. */
export const PORTFOLIO_STYLE_KEYS = [
  'illustrative',
  'neo-traditional',
  'new-school',
  'cover-up',
  'blackwork',
  'color',
] as const;

const styles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/styles' }),
  schema: z.object({
    /** Adjective form used in headings and nav: "Neo-traditional". */
    title: z.string().min(2),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    h1: z.string().min(10).max(80),
    metaTitle,
    description: metaDescription,
    answer: answerParagraph,
    /** Manifest style key the page's FlashGrid filters on. */
    portfolioStyle: z.enum(PORTFOLIO_STYLE_KEYS),
    /** One sentence shown near the "Also serving" location links. */
    areaServedNote: z.string().min(20).max(220),
    /** Short line for style cards / nav teasers. */
    tagline: z.string().min(10).max(120),
    order: z.number().int().nonnegative(),
  }),
});

const locations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/locations' }),
  schema: z.object({
    /** Display name: "Providence", "East Providence", "Rhode Island". */
    city: z.string().min(2),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    h1: z.string().min(10).max(80),
    metaTitle,
    description: metaDescription,
    answer: answerParagraph,
    /**
     * Approximate drive time to the shop in minutes. 0 = the shop's own city.
     * Omitted on the statewide page, where a single number would be invented.
     */
    driveMinutes: z.number().int().nonnegative().optional(),
    /** Human-readable drive callout, safe to print verbatim. */
    driveLabel: z.string().min(10).max(140),
    /** One or two sentences of route guidance for the drive-time callout. */
    routeNote: z.string().min(20).max(400),
    /** Real, verifiable local references used on the page. */
    landmarks: z.array(z.string().min(2)).min(2).max(10),
    order: z.number().int().nonnegative(),
  }),
});

export const FAQ_CATEGORIES = ['booking', 'pricing', 'process', 'aftercare', 'location'] as const;

const faq = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
  schema: z.object({
    /** Natural-language question, used as the H2 and the FAQPage `name`. */
    question: z.string().min(10).max(120).refine((q) => q.trim().endsWith('?'), {
      message: 'question must end with a question mark',
    }),
    answer: answerParagraph,
    order: z.number().int().nonnegative(),
    /** Shown in the home-page FAQ excerpt. Exactly five entries are true. */
    home: z.boolean().default(false),
    category: z.enum(FAQ_CATEGORIES),
  }),
});

export const collections = { styles, locations, faq };
