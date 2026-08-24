# Chris Valencia Tattoo — website

Marketing and booking site for tattoo artist **Chris Valencia**, resident artist at
[Powerline Tattoo](https://powerlinetattoo.com), 706 Reservoir Avenue, Cranston, RI 02910.
Its one job is to turn local and AI-search traffic into booking requests in the inbox.

- Static [Astro 5](https://astro.build) site (`src/`) built to `dist/`
- A small Express server (`server/`) that serves `dist/` and exposes `POST /api/book`
  (multer uploads → nodemailer email, honeypot, rate limit, optional Cloudflare Turnstile)
- One Docker image, deployed to Railway
- Design language: "Flash Sheet" (cream paper, ink, vermilion, registration marks, numbered sheets)

Spec: `docs/superpowers/specs/2026-08-23-chris-valencia-site-design.md`.
Plan: `docs/superpowers/plans/2026-08-23-chris-valencia-site.md`.

## Quick start

Node 22 is required (Node 25's npm is broken on the build machine).

```sh
export PATH=$HOME/.local/node/node-v22.22.0-darwin-arm64/bin:$PATH   # this machine only
npm ci
npm run dev            # Astro dev server, pages only (no /api/book)
npm run build          # -> dist/
npm start              # Express on :3000 serving dist/ + POST /api/book
```

Without `SMTP_*` set, the server still serves the site; `POST /api/book` answers
`503` with a plain-language message (and the form shows the phone/Instagram fallback).

## Scripts

| Script            | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| `npm run dev`     | Astro dev server                                                         |
| `npm run build`   | Static build to `dist/` (sitemap, `robots.txt`, `llms.txt` included)     |
| `npm run preview` | Astro preview of `dist/` (no API)                                        |
| `npm start`       | `node server/index.js` — production server                               |
| `npm test`        | Vitest unit tests (booking API, JSON-LD builders, portfolio manifest)     |
| `npm run e2e`     | Playwright end-to-end tests (builds, boots the server, drives the site)  |
| `npm run lhci`    | Lighthouse CI against the five audited URLs                              |

## Project layout

```
src/data/shop.json          shop + artist facts: the single source of truth
src/data/portfolio.json     32 pieces: file, size, title, style[], placement, alt, featured
src/content/{styles,locations,faq}/*.md   content collections (schemas in src/content.config.ts)
src/layouts/Base.astro      <head> SEO, fonts, theme, JSON-LD, header/footer
src/components/             FlashGrid, Lightbox, BookingForm, Header, Footer, …
src/lib/schema.ts           JSON-LD builders   ·   src/lib/seo.ts   URLs + link mesh
src/pages/                  routes, incl. llms.txt.ts and robots.txt.ts endpoints
public/images/portfolio/    optimized JPEGs   ·   public/favicon.svg, public/og-default.jpg
server/index.js             Express app       ·   server/book.js   validation, email, handler
tests/unit, tests/e2e       Vitest, Playwright
scripts/import-images.sh    re-import photos from the Powerline repo (macOS sips)
```

## Adding or replacing photos

1. Export the photo as a JPEG, longest edge 1400 px, quality ~82, under ~400 KB.
   `scripts/import-images.sh` does exactly this for the Powerline gallery with `sips`.
2. Drop it in `public/images/portfolio/` as `chris-NN.jpg` (next free number).
3. Add an entry to `src/data/portfolio.json`:

   ```json
   {
     "id": "chris-33",
     "file": "/images/portfolio/chris-33.jpg",
     "width": 1120,
     "height": 1400,
     "title": "Short descriptive title",
     "style": ["neo-traditional", "color"],
     "placement": "Forearm",
     "alt": "What is in the picture, style, placement (≤ 125 chars)",
     "featured": false
   }
   ```

   Allowed `style` keys: `illustrative`, `neo-traditional`, `new-school`, `cover-up`,
   `blackwork`, `color`. Exactly eight entries are `featured: true` (home hero + grid).
   Get width/height with `sips -g pixelWidth -g pixelHeight public/images/portfolio/chris-33.jpg`.
4. `npm test` — the manifest test checks the file exists, the alt length, the style
   keys and the featured count. `npm run build` regenerates the WebP variants.

The OG image (`public/og-default.jpg`, 1200×630) is a rendered composition of the
"Ship in a Teacup" piece with the site typography; regenerate it if that piece is
ever removed.

## Content rules

- **Never invent facts.** No dollar amounts, no "N years of experience", no hours beyond
  "Monday–Saturday, by appointment only", no testimonials. Unknowns read as
  "confirmed when you book" / "quoted at the consultation" and are listed below.
- Every question-style heading is followed by a 40–60 word answer-first paragraph
  (the collection schemas enforce this for frontmatter `answer` fields).
- Each location page is at least 350 words unique to that city, with real landmarks.
- Titles ≤ 60 characters, descriptions 120–160 (the build warns), one H1 per page,
  canonical + OG/Twitter with absolute image, BreadcrumbList on inner pages.
- Facts live in `src/data/shop.json` and the content collections only. The server has
  its own copy of the fallback contact details in `server/book.js` (`FALLBACK_CONTACT`)
  because the runtime image only ships `dist/` + `server/`; keep the two in sync.

## Environment variables

### Build time (Astro, static)

| Variable                    | Purpose                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                  | Public origin, e.g. `https://chrisvalenciatattoo.com`. Drives canonical, OG, sitemap, JSON-LD, `llms.txt` and `robots.txt` URLs. Defaults to `https://chrisvalenciatattoo.com`. |
| `PUBLIC_TURNSTILE_SITE_KEY` | Optional. Renders the Cloudflare Turnstile widget in the booking form. Must be paired with `TURNSTILE_SECRET` on the server; set both or neither. |

Because the site is static, `SITE_URL` has to be present **when `npm run build` runs**
(in Docker, pass it as a build arg / Railway build variable), not only at runtime.

### Runtime (Express)

| Variable           | Required | Purpose                                                                                   |
| ------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `PORT`             | no       | Listen port (default `3000`)                                                              |
| `SMTP_HOST`        | for mail | SMTP server. Without it the form answers `503` and says so.                               |
| `SMTP_PORT`        | no       | Default `587`                                                                             |
| `SMTP_SECURE`      | no       | `true` for implicit TLS (default: `true` only when port is `465`)                         |
| `SMTP_USER`        | no       | SMTP login                                                                                |
| `SMTP_PASS`        | no       | SMTP password / app password                                                              |
| `MAIL_TO`          | no       | Destination inbox. Default `info@powerlinetattoo.com`; switch to Chris's own address later |
| `MAIL_FROM`        | no       | From address (default `SMTP_USER`, then `MAIL_TO`)                                        |
| `SITE_URL`         | no       | Used in the email footer ("Source: …/book/")                                              |
| `TURNSTILE_SECRET` | no       | Enables server-side Turnstile verification on `/api/book`                                 |

`GET /healthz` reports `{ ok: true, mail: "ready" | "verifying" | "failed" | "unconfigured" }`.

## The booking form

`src/components/BookingForm.astro` ↔ `server/book.js` share one contract:

- Fields `name`, `email`, `phone` (optional), `idea`, `placement`, `size`, `budget`,
  `timing`, `consent=on`; honeypot `website` (must stay empty); files under
  `references` (≤ 5 images, ≤ 8 MB each; images are downscaled before mailing).
- With JavaScript: XHR submit with an upload progress bar, inline field errors that
  mirror the server's messages, drag-and-drop / paste references with thumbnails and
  per-file removal, a sessionStorage draft, and an inline alert with phone + Instagram
  fallbacks on any failure.
- Without JavaScript: a plain multipart POST. The server answers `303 → /thanks/` on
  success and a small self-contained HTML notice on errors.
- `size` / `budget` / `timing` option values are pinned by `tests/unit/book.test.js`.
  Budget bands are what the client has in mind, not a price list.

Smoke test a running server:

```sh
curl -i -X POST http://localhost:3000/api/book -F name=Test      # 503 JSON without SMTP
curl -s http://localhost:3000/healthz
```

## Testing

```sh
npm test          # unit: server/book.js + server/index.js, JSON-LD, portfolio manifest
npm run e2e       # Playwright: every sitemap route 200 + one H1 + parseable JSON-LD,
                  # portfolio filter, lightbox, booking form paths, theme toggle
npm run lhci      # Lighthouse ≥ 0.95 on /, /portfolio/, /book/, one style, one location
```

## Deploy

Direct-to-`main` after local Docker verification (the owner's standard):

```sh
docker build -t cvt --build-arg SITE_URL=https://<domain> .
docker run --rm -p 3011:3000 -e SITE_URL=https://<domain> cvt
curl -I http://localhost:3011/                 # 200
curl -i -X POST http://localhost:3011/api/book -F name=x   # 503 JSON (no SMTP in the container)
```

Railway: project `chris-valencia-tattoo`, service connected to this repo. Set the
runtime variables above (SMTP from the Powerline service's Google Workspace `info@`
account until Chris has his own), `SITE_URL` as a build **and** runtime variable, and
use the generated `*.up.railway.app` domain until the real domain is bought. After the
first deploy, send one real submission with the subject prefixed `[TEST]` and check the
inbox.

## Facts to confirm with Chris

Nothing below appears on the site as a number or a promise. Each is phrased as
"confirmed when you book" or left out until Chris confirms it.

- [ ] **Hourly rate / shop minimum** (the site says "quoted at the consultation")
- [ ] **Deposit amount** and the reschedule / cancellation / refund terms
- [ ] **Consultation format**: which pieces need an in-person look vs. email; how far ahead
- [ ] **Walk-in policy** for the shop as a whole (site: appointment-only, ask about same-week openings)
- [ ] **Chris's own booking email** → set `MAIL_TO` (currently `info@powerlinetattoo.com`)
- [ ] **Personal days / hours** at the shop (site shows the shop's Monday–Saturday, by appointment)
- [ ] **Years tattooing** as a number (site says "about eight years in West Texas" and
      "about ten years ago to Atlanta", straight from his bio); the West Texas town name
      if he wants it named
- [ ] **Testimonials / reviews** he wants featured (none are used)
- [ ] **Parking**: street vs. lot specifics for Reservoir Avenue
- [ ] **Payment methods** accepted (not mentioned anywhere on the site)
- [ ] **Age / ID policy wording** (site: 18+ with government-issued photo ID, per RI law)
- [ ] **Budget bands on the form** (Under $300 · $300–600 · $600–1,200 · $1,200+ · Not sure): keep or change
- [ ] **Numbing products** policy and any **aftercare product** he recommends
- [ ] **Cover-up and scar** wording (site: in-person assessment, no guarantees, laser fading sometimes needed)
- [ ] **Subjects or styles he won't take** (nothing is stated)
- [ ] **Portfolio**: titles, alt text and style tags are our reads of the photos; confirm
      them, confirm every client is fine with their tattoo being shown, and confirm the
      eight `featured` picks
- [ ] **Headshot and video** are the ones he wants; **Instagram** handle `@cvalencia7`
- [ ] **Domain name** (see below) and whether the site should be linked from powerlinetattoo.com

## Domain suggestions

The build defaults to `https://chrisvalenciatattoo.com`; availability of every name
below is unverified and none has been purchased.

- `chrisvalenciatattoo.com` (matches the default and the site name)
- `chrisvalencia.tattoo`
- `cvalenciatattoo.com` (matches the Instagram handle)
- `valenciatattoo.com`

## SEO / GEO notes

- JSON-LD: `WebSite` on every page; `Person` (Chris) with `worksFor` → `TattooParlor`
  (Powerline, with address, geo, opening days, `sameAs` Instagram); `BreadcrumbList` on
  inner pages; `FAQPage` with speakable answers; `HowTo` on aftercare; `Service` with
  `areaServed` on style and location pages; `ImageObject`/`ItemList` on the portfolio.
- `/llms.txt` is generated from the same data as the pages; `/robots.txt` allows
  everything except `/api/` and points at `/sitemap-index.xml`.
- The sitemap comes from `@astrojs/sitemap`; `/thanks/` is `noindex`.
