# Chris Valencia Tattoo Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fast, distinctive, SEO/GEO/AEO-optimized marketing site for tattoo artist Chris Valencia that converts RI-area searchers into booking-form emails.

**Architecture:** Astro 5 static site (content collections drive style/location/FAQ/portfolio pages) built to `dist/`, served by a small Express server that also exposes `POST /api/book` (multer uploads → nodemailer). One Docker image, deployed to Railway.

**Tech Stack:** Astro 5, TypeScript, Express 4, multer, nodemailer 9, helmet, express-rate-limit, zod, Vitest, Playwright, @lhci/cli, sharp (via Astro image), Docker, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-23-chris-valencia-site-design.md`

## Global Constraints

- Node 22 for all installs/builds: `export PATH=$HOME/.local/node/node-v22.22.0-darwin-arm64/bin:$PATH` (Node 25 npm is broken on this machine).
- Working dir: `/Users/chrisskerritt/Documents/New project/ChrisValenciaWebsite`. Branch `main`, commit directly, **do not push** until the final Docker verification task.
- Never invent facts. Unknowns (rates, deposit, minimum, walk-ins, personal hours, years as a number, testimonials, Chris's email) must render as clearly-labelled "confirm at consultation / ask Chris" copy and be listed in `README.md` § "Facts to confirm with Chris".
- Shop facts (verified): Powerline Tattoo, 706 Reservoir Avenue, Cranston, RI 02910; +1-401-369-7771; info@powerlinetattoo.com; https://powerlinetattoo.com; lat 41.7721 lon -71.4352; Mon–Sat, by appointment only.
- Artist facts: Chris Valencia; Instagram https://instagram.com/cvalencia7; video https://www.youtube-nocookie.com/embed/PxfH5-cOwHo; bio per spec §2.
- Assets source: `~/powerline-tattoo/public/images/gallery/chris-valencia/chris-01..32.png` (≈1500 px PNG, 45 MB total) and `~/powerline-tattoo/public/images/artists/chris-valencia.jpg`.
- Copy rules: answer-first paragraph (40–60 words) under every question-style heading; each location page ≥ 350 words unique to that city; no keyword stuffing; no em-dash-heavy "AI voice"; American English.
- Design: "Flash Sheet" identity per spec §5. Light-first with dark mode. All colors as CSS tokens on `:root`, overridden under `[data-theme="dark"]` and `prefers-color-scheme`.
- Every page: title ≤ 60 chars, description 120–160 chars, canonical, OG/Twitter with absolute image, BreadcrumbList (inner pages), one H1.
- Lighthouse ≥ 95 in all four categories on `/`, `/portfolio/`, `/book/`, `/styles/neo-traditional/`, `/tattoo-artist/providence/`.

## File structure

```
package.json, astro.config.mjs, tsconfig.json, Dockerfile, .dockerignore, .gitignore, README.md
src/
  data/shop.json            # shop + artist facts, single source of truth
  data/portfolio.json       # 32 entries: file,title,style[],placement,alt,featured
  content.config.ts         # collections: styles, locations, faq
  content/styles/*.md       # 4 style pages
  content/locations/*.md    # 8 location pages
  content/faq/*.md          # 12+ Q&A entries (frontmatter: question, order, home:boolean)
  styles/tokens.css         # color/type/spacing tokens + dark theme
  styles/global.css         # reset, base type, ornaments (.reg-marks, .halftone, .sheet-no)
  layouts/Base.astro        # <head> SEO, fonts, theme script, Header/Footer, JSON-LD slot
  components/Seo.astro      # title/desc/canonical/OG
  components/JsonLd.astro   # <script type=ld+json> from object
  components/Header.astro, Footer.astro, ThemeToggle.astro
  components/FlashGrid.astro   # flash-sheet gallery (irregular spans) + Lightbox
  components/Lightbox.astro    # <dialog>-based, keyboard, focus trap
  components/Process.astro, VideoEmbed.astro, Cta.astro, FaqList.astro, Breadcrumbs.astro
  components/BookingForm.astro # form markup + client JS (fetch /api/book)
  lib/schema.ts             # JSON-LD builders (person, parlor, faq, howto, service, image, breadcrumb)
  lib/seo.ts                # absoluteUrl(), truncate helpers
  pages/index.astro, portfolio.astro, about.astro, book.astro, faq.astro, aftercare.astro, pricing.astro, thanks.astro, 404.astro
  pages/styles/[slug].astro, pages/tattoo-artist/[slug].astro
  pages/llms.txt.ts, pages/robots.txt.ts
public/images/portfolio/chris-01..32.jpg  # optimized 1400px JPEG q82 (from PNG)
public/images/chris-valencia.jpg, public/favicon.svg, public/og-default.jpg
server/index.js             # express: static dist + /api/book
server/book.js              # zod schema, buildEmail(), createBookHandler(deps)
tests/unit/book.test.js, tests/unit/schema.test.ts
tests/e2e/site.spec.ts      # Playwright
lighthouserc.json
scripts/import-images.sh    # sips conversion from Powerline repo
```

---

### Task 1: Scaffold Astro + tooling

**Files:** Create `package.json`, `astro.config.mjs`, `tsconfig.json`, `.gitignore`, `src/pages/index.astro` (placeholder), `vitest.config.ts`, `playwright.config.ts`.

- [ ] Step 1: `npm create astro@latest . -- --template minimal --typescript strict --no-install --no-git --yes` (Node 22 PATH). Then `npm i` and `npm i -D vitest @playwright/test @lhci/cli` and `npm i express multer nodemailer helmet express-rate-limit zod @astrojs/sitemap sharp`.
- [ ] Step 2: `astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
export default defineConfig({
  site: process.env.SITE_URL || 'https://chrisvalenciatattoo.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' },
});
```
- [ ] Step 3: scripts in package.json: `dev`, `build` (`astro build`), `start` (`node server/index.js`), `test` (`vitest run`), `e2e` (`playwright test`), `lhci` (`lhci autorun`).
- [ ] Step 4: `.gitignore`: `node_modules dist .astro test-results playwright-report .lighthouseci .env`.
- [ ] Step 5: `npm run build` succeeds. Commit `chore: scaffold astro site`.

### Task 2: Import and optimize assets + portfolio manifest

**Files:** Create `scripts/import-images.sh`, `public/images/portfolio/*.jpg`, `public/images/chris-valencia.jpg`, `src/data/portfolio.json`, `src/data/shop.json`.

**Produces:** `portfolio.json` entries `{ id:"chris-01", file:"/images/portfolio/chris-01.jpg", width, height, title, style:("illustrative"|"neo-traditional"|"new-school"|"cover-up"|"blackwork"|"color")[], placement, alt, featured:boolean }`.

- [ ] Step 1: `scripts/import-images.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
SRC="$HOME/powerline-tattoo/public/images/gallery/chris-valencia"
OUT="public/images/portfolio"; mkdir -p "$OUT"
for f in "$SRC"/chris-*.png; do b=$(basename "$f" .png)
  sips -s format jpeg -s formatOptions 82 -Z 1400 "$f" --out "$OUT/$b.jpg" >/dev/null; done
sips -s format jpeg -s formatOptions 85 -Z 800 "$HOME/powerline-tattoo/public/images/artists/chris-valencia.jpg" --out public/images/chris-valencia.jpg >/dev/null
```
- [ ] Step 2: Run it; verify 32 JPEGs each < 400 KB (`du -ch public/images/portfolio`).
- [ ] Step 3: **Look at every image** (Read tool on each JPEG) and write `portfolio.json` with a real descriptive `title`, `alt` (subject + style + placement if visible, ≤ 125 chars), `style[]`, `placement`, and mark 8 `featured: true` (strongest, varied). Record width/height via `sips -g pixelWidth -g pixelHeight`.
- [ ] Step 4: `src/data/shop.json`:
```json
{
  "artist": { "name": "Chris Valencia", "instagram": "https://instagram.com/cvalencia7", "instagramHandle": "@cvalencia7", "video": "https://www.youtube-nocookie.com/embed/PxfH5-cOwHo", "headshot": "/images/chris-valencia.jpg", "specialties": ["illustrative", "neo-traditional", "new-school"] },
  "shop": { "name": "Powerline Tattoo", "streetAddress": "706 Reservoir Avenue", "addressLocality": "Cranston", "addressRegion": "RI", "postalCode": "02910", "telephone": "+1-401-369-7771", "telephoneDisplay": "(401) 369-7771", "email": "info@powerlinetattoo.com", "url": "https://powerlinetattoo.com", "latitude": 41.7721, "longitude": -71.4352, "days": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"], "hoursNote": "By appointment only" },
  "unconfirmed": ["hourly rate / shop minimum", "deposit amount", "walk-in policy", "Chris's personal booking email", "years tattooing as a number", "client testimonials"]
}
```
- [ ] Step 5: Unit test `tests/unit/portfolio.test.ts`: every entry has non-empty alt ≤ 125 chars, file exists on disk, exactly 8 featured, styles from the allowed set. Run, pass. Commit `feat: import portfolio assets + manifest`.

### Task 3: Design tokens, global styles, Base layout, Header/Footer, theme toggle

**Files:** `src/styles/tokens.css`, `src/styles/global.css`, `src/layouts/Base.astro`, `src/components/{Seo,JsonLd,Header,Footer,ThemeToggle,Breadcrumbs}.astro`, `src/lib/seo.ts`.

**Produces:** `Base.astro` props `{ title, description, canonicalPath, ogImage?, jsonLd?: object[] , breadcrumbs?: {name,path}[] }`. `absoluteUrl(path)` in `lib/seo.ts`.

- [ ] Step 1: `tokens.css` — `:root { --paper:#F4EDE0; --paper-2:#EAE1CF; --ink:#161412; --ink-2:#4A443D; --accent:#D63A1E; --accent-ink:#A82A12; --sage:#5E6B52; --rule:#C9BEA8; --font-display:'Bricolage Grotesque',Impact,sans-serif; --font-serif:'Fraunces',Georgia,serif; --font-body:'Inter Tight',system-ui,sans-serif; --max:1180px; --gutter:clamp(16px,4vw,48px); }` plus `[data-theme="dark"]` and `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) }` overrides: paper `#141210`, paper-2 `#1D1A16`, ink `#F1EAD9`, ink-2 `#B8AE9C`, rule `#3A342C`, accent `#FF5A3C`.
- [ ] Step 2: `global.css` — reset; body bg `var(--paper)` color `var(--ink)`; fluid type scale (`--step-0..5` via clamp); `.reg-marks` (pseudo-elements draw registration crosshairs at section corners with SVG data URI); `.halftone` (radial-gradient dot texture, opacity .08); `.sheet-no` (`font-family:var(--font-serif);font-style:italic;`), `.rule-hand` (SVG wavy line); `.skip-link`, `:focus-visible` outline accent 3px; `.reveal` visible by default, hidden only when `html.js` + not reduced motion; 44 px min targets on buttons/links in nav.
- [ ] Step 3: `Base.astro` — Google Fonts preconnect + `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,600&family=Inter+Tight:wght@400;500;600&display=swap">`; inline theme script (reads localStorage `theme`, sets `data-theme`, adds `js` class); `<Seo/>`; JSON-LD for `WebSite` always + passed `jsonLd[]`; Header, `<main id="main">`, Footer.
- [ ] Step 4: `Header.astro` — wordmark "Chris Valencia" (display) + small serif italic "Tattoo · Cranston, RI"; nav: Portfolio, Styles, About, FAQ, Book (accent button); mobile `<details>`-free JS-toggle with `aria-expanded`; ThemeToggle.
- [ ] Step 5: `Footer.astro` — shop NAP block (address as `<address>`, tel link, Instagram), links to every style + location + FAQ/Aftercare/Pricing (the link mesh), "Resident artist at Powerline Tattoo" link, © year.
- [ ] Step 6: Home placeholder renders through Base. `npm run build` OK. Commit `feat: flash-sheet design system + base layout`.

### Task 4: JSON-LD builders

**Files:** `src/lib/schema.ts`, `tests/unit/schema.test.ts`.

**Produces:** `person()`, `tattooParlor()`, `faqPage(items:{q,a}[])`, `howTo(name, steps:{name,text}[])`, `service(name, description, areaServed:string[], path)`, `imageObject(entry)`, `breadcrumbs(items:{name,path}[])` — all return plain objects with `@context`.

- [ ] Step 1: Tests: `person().worksFor['@type']==='TattooParlor'`, `sameAs` includes Instagram, `faqPage` maps to `mainEntity[].acceptedAnswer.text`, `breadcrumbs` positions 1..n with absolute `item`, `tattooParlor().openingHoursSpecification.dayOfWeek.length===6`, `geo` present.
- [ ] Step 2: Implement from `shop.json` + `absoluteUrl`. `person()` fields: name, jobTitle "Tattoo Artist", worksFor (parlor), sameAs [instagram], image (headshot abs), url, knowsAbout specialties, address (parlor address).
- [ ] Step 3: Tests pass. Commit `feat: json-ld builders`.

### Task 5: Content collections + copy (styles, locations, FAQ)

**Files:** `src/content.config.ts`, `src/content/styles/{illustrative,neo-traditional,new-school,cover-ups}.md`, `src/content/locations/{cranston,providence,warwick,johnston,west-warwick,east-providence,pawtucket,rhode-island}.md`, `src/content/faq/*.md` (≥ 12).

**Schemas:**
```ts
styles: { title, slug, metaTitle, description, answer (40–60 words), portfolioStyle (manifest style key), areaServedNote, order }
locations: { city, slug, metaTitle, description, answer, driveMinutes, routeNote, landmarks[], order }
faq: { question, order, home:boolean, category:'booking'|'pricing'|'process'|'aftercare'|'location' }
```
- [ ] Step 1: Define schemas with zod via `defineCollection` + `glob` loader.
- [ ] Step 2: Write style pages (400–600 words each): what the style is (answer-first), what Chris brings to it (surreal/animated/whimsical, combining elements), what subjects suit it, sizing/placement guidance, how to book. `cover-ups` explains candidacy honestly (needs in-person assessment; darker/larger; no guarantees).
- [ ] Step 3: Write location pages, each ≥ 350 unique words: opening answer ("Chris Valencia tattoos out of Powerline Tattoo at 706 Reservoir Ave in Cranston, about N minutes from {city} via {route}"), what to expect at the shop (appointment-only, parking on Reservoir Ave/lot — say "street and lot parking; confirm when booking" not specifics you can't verify), why people travel for a specific artist, style match, link mesh to styles + book. Drive times (approx, state "about"): Cranston 0 (local), Providence 10, Warwick 12, Johnston 12, West Warwick 15, East Providence 15, Pawtucket 20; `rhode-island` page covers statewide + nearby MA/CT commuters in one sentence. Local references must be real (e.g., Providence: Federal Hill, Brown/RISD; Warwick: T.F. Green Airport; Pawtucket: Slater Mill; East Providence: Bold Point Park; Johnston: Route 6; West Warwick: Arctic village; Cranston: Garden City, Rolfe Square).
- [ ] Step 4: FAQ entries (question-form headings; answer-first 40–60 words then detail): how do I book; does Chris do consultations; what styles; how much does a tattoo cost (explain factors, "quoted at consultation"; deposit = "a deposit is required to hold your appointment; amount confirmed when booking"); walk-ins ("Powerline is appointment-only; ask about same-week openings"); where is the shop / parking; what should I bring; how to prepare (eat, hydrate, no alcohol 24h, sleep); pain; how long does healing take; can you cover up an old tattoo; do you tattoo over scars; do you draw custom designs; can I bring a reference; minimum age (18 with valid ID; no minors — state as shop policy with "confirm" note only if unsure: RI law is 18 without parental consent; say "18+ with government ID"); how far in advance to book. Mark 5 `home:true`.
- [ ] Step 5: Build passes with collections loaded (temporary test page or console). Commit `feat: content collections + copy`.

### Task 6: Portfolio components (FlashGrid + Lightbox) and `/portfolio/`

**Files:** `src/components/FlashGrid.astro`, `src/components/Lightbox.astro`, `src/pages/portfolio.astro`.

- [ ] Step 1: `FlashGrid` props `{ items, filterable?:boolean, limit?:number }`. Layout: CSS grid `repeat(auto-fill, minmax(180px,1fr))`, `grid-auto-flow: dense`; items with `featured` get `grid-column: span 2; grid-row: span 2`; each tile: `<button class="tile" data-id data-styles>` wrapping `<img loading="lazy" decoding="async" width height alt>` and a caption strip `No. 07 · Neo-traditional · Forearm` in serif italic; 1px `var(--rule)` border; hover: caption strip slides to accent. Filter chips (`<button aria-pressed>`) for All/illustrative/neo-traditional/new-school/cover-up; filtering via `hidden` attribute, no layout lib.
- [ ] Step 2: `Lightbox` — a single `<dialog>` with `<img>`, caption, prev/next, close; opens on tile click; arrow keys; focus returns to tile; `Escape` closes; `aria-label`s.
- [ ] Step 3: `/portfolio/` page: H1 "Tattoo Portfolio", intro answer paragraph, FlashGrid filterable, `ImageObject` JSON-LD list (`ItemList` of images), breadcrumbs, CTA.
- [ ] Step 4: Commit `feat: portfolio flash grid + lightbox`.

### Task 7: Home, About, FAQ, Aftercare, Pricing, Thanks, 404

**Files:** `src/pages/{index,about,faq,aftercare,pricing,thanks,404}.astro`, `src/components/{Process,VideoEmbed,Cta,FaqList}.astro`.

- [ ] Step 1: Home: hero split — left: eyebrow "Sheet No. 01 · Cranston, Rhode Island", H1 "Illustrative & neo-traditional tattoos with a surreal, animated edge", 50-word answer paragraph naming Chris, Powerline, Cranston, styles; primary CTA "Request a booking" → `/book/`, secondary "See the portfolio"; right: featured piece with reg-marks frame, cross-fading through 4 featured images every 5 s (paused under reduced motion). Sections: 8 featured FlashGrid (non-filterable) → Process (Consult / Design / Session / Heal, numbered sheet labels) → About teaser + video → Styles trio cards → "Serving" strip linking all 8 location pages → FAQ (home:true, `FAQPage` JSON-LD) → Cta. JSON-LD: `person()`, `tattooParlor()`, `faqPage`.
- [ ] Step 2: About: headshot, bio expanded from spec §2 (do not add years beyond "about 8 years in Texas / about 10 years ago to Atlanta"), what he looks for in a project, video, Instagram CTA, `person()` JSON-LD.
- [ ] Step 3: FAQ: all entries grouped by category, `<h2>` per question, `FAQPage` JSON-LD, `speakable` on answers (`class="speakable"` + `SpeakableSpecification cssSelector`).
- [ ] Step 4: Aftercare: `HowTo` JSON-LD, steps (leave wrap per artist instruction, wash with fragrance-free soap, thin layer of unscented moisturizer, no soaking/sun/gym 2 weeks, don't pick, when to contact) + "when to call the shop" box; disclaimer "follow the specific instructions Chris gives you at your appointment".
- [ ] Step 5: Pricing: how quotes work (size, placement, detail, color, sessions), deposit paragraph with **explicit "confirmed when you book"** wording, payment note omitted (unknown), CTA. No dollar figures.
- [ ] Step 6: Thanks (noindex) and 404 (flash-sheet "No. 404" joke, links). Commit `feat: core pages`.

### Task 8: Dynamic style + location pages

**Files:** `src/pages/styles/[slug].astro`, `src/pages/tattoo-artist/[slug].astro`.

- [ ] Step 1: `getStaticPaths` from collections. Style page: H1 `{title} tattoos in Cranston, RI`, answer, rendered body, FlashGrid filtered to `portfolioStyle` (fallback to featured if < 4 matches), "Also serving" location links, `service()` JSON-LD with `areaServed` = all 8 city names, breadcrumbs, Cta.
- [ ] Step 2: Location page: H1 `Tattoo artist near {city}, RI — Chris Valencia`, answer, body, drive-time callout with Google Maps directions link (`https://www.google.com/maps/dir/?api=1&destination=706+Reservoir+Ave+Cranston+RI+02910`), 4 featured pieces, styles links, `service()` JSON-LD with `areaServed:[city]` + `tattooParlor()`, breadcrumbs, Cta.
- [ ] Step 3: Commit `feat: style + location pages`.

### Task 9: Booking form + server

**Files:** `src/components/BookingForm.astro`, `src/pages/book.astro`, `server/book.js`, `server/index.js`, `tests/unit/book.test.js`.

**Produces:** `createBookHandler({ sendMail, mailTo, verifyTurnstile })` Express handler; `bookingSchema` (zod); `buildEmail(data, files)` → `{subject, text, html}`.

- [ ] Step 1: Tests (Vitest, supertest not needed—call handler with mock req/res):
  - valid payload → `sendMail` called once, subject `"Booking request — {name} — {placement}"`, 200 `{ok:true}`.
  - honeypot `website` filled → 200 `{ok:true}` but `sendMail` NOT called.
  - missing email → 400 with field errors.
  - `sendMail` throws → 502 with generic message.
  - `mailTo` undefined → 503.
- [ ] Step 2: `book.js`: schema `{ name:1–80, email:email, phone: optional ≤ 30, idea: 10–2000, placement: 1–80, size: enum ['palm','hand','half-sleeve','sleeve','back','other'], budget: enum ['under-300','300-600','600-1200','1200-plus','unsure'], timing: enum ['asap','1-3-months','3-plus-months','flexible'], consent: literal 'on', website: optional }`. `buildEmail` renders labelled lines + attachment list. Handler: honeypot short-circuit, parse, Turnstile if configured, send with attachments from `req.files` (multer memory storage, `limits:{fileSize:8*1024*1024, files:5}`, image mime filter), reply-to = client email.
- [ ] Step 3: `server/index.js`: helmet (CSP off), `trust proxy 1`, rate-limit `/api/` 6/15 min, `express.static('dist', {extensions:['html'], maxAge:'7d'})`, `/api/book` route, JSON error middleware (multer errors → 400 message), 404 → `dist/404.html`, listen `PORT||3000`. Boot: build transporter from `SMTP_*`, `verify()` → log "SMTP ready" or warn; handler gets `sendMail` only if verified.
- [ ] Step 4: `BookingForm.astro`: semantic form, labels, required, `enctype=multipart/form-data`, hidden `website` field (aria-hidden, tabindex -1), file input `accept="image/*" multiple`, progress state on submit button, fetch → on ok `location.href='/thanks/'`, on error show inline `role="alert"` message with tel + Instagram fallback. No-JS fallback: plain POST works (server redirects 303 to `/thanks/` when `Accept` lacks json).
- [ ] Step 5: `/book/` page: H1 "Request a booking with Chris", 45-word answer (what happens after you submit: reply by email, consult, deposit to hold), form, sidebar "What to include" + shop NAP, breadcrumbs.
- [ ] Step 6: Tests pass; `npm run build && node server/index.js` → curl `/` 200, curl `-F` post returns 503 without SMTP. Commit `feat: booking form + api`.

### Task 10: llms.txt, robots, OG image, favicon, README

**Files:** `src/pages/llms.txt.ts`, `src/pages/robots.txt.ts`, `public/favicon.svg`, `public/og-default.jpg`, `README.md`.

- [ ] Step 1: `llms.txt` (Markdown): who Chris is, styles, shop NAP, how to book, links to key pages. `robots.txt`: allow all, sitemap URL.
- [ ] Step 2: `favicon.svg`: "CV" monogram in display face on paper square with accent corner mark. `og-default.jpg`: 1200×630 composed with sips/ImageMagick from a featured piece (or a bespoke SVG rendered via Playwright screenshot).
- [ ] Step 3: README: what it is, `npm` scripts, adding photos (drop JPEG + manifest entry + `npm test`), env vars, deploy, **Facts to confirm with Chris** list, domain suggestions.
- [ ] Step 4: Commit `feat: llms.txt, robots, og, readme`.

### Task 11: E2E + Lighthouse + adversarial copy review

**Files:** `tests/e2e/site.spec.ts`, `lighthouserc.json`, `playwright.config.ts`.

- [ ] Step 1: Playwright config: `webServer: { command: 'npm run build && node server/index.js', port: 3000 }`. Tests: iterate all routes from sitemap (`/sitemap-0.xml`) → 200, exactly one `h1`, `script[type="application/ld+json"]` parses; portfolio filter hides non-matching tiles; lightbox opens/closes with Escape; booking form honeypot path shows success; theme toggle sets `data-theme`.
- [ ] Step 2: `lighthouserc.json` assertions ≥ 0.95 on the 5 URLs; run `npm run lhci`; fix regressions (image sizes, font loading, CLS).
- [ ] Step 3: Copy review: dispatch a reviewer to grep every page for invented numbers (`\$\d`, `\d+ years`), duplicate paragraphs across location pages (compare sentence sets), missing answer paragraphs, and generic filler; fix findings.
- [ ] Step 4: Commit `test: e2e + lighthouse`.

### Task 12: Docker, local verification, push, Railway

**Files:** `Dockerfile`, `.dockerignore`.

- [ ] Step 1: Dockerfile (multi-stage): `node:22-alpine` build (`npm ci && npm run build`) → runtime `node:22-alpine` with `npm ci --omit=dev`, copy `dist` + `server`, `USER node`, `EXPOSE 3000`, `CMD ["node","server/index.js"]`.
- [ ] Step 2: `docker build -t cvt . && docker run --rm -p 3011:3000 cvt` → curl `/`, `/portfolio/`, `/api/book` (expect 503 JSON). Stop container.
- [ ] Step 3: Push `main`. Create Railway project `chris-valencia-tattoo` via MCP, connect GitHub repo, set `SITE_URL` to the generated domain for now; SMTP vars copied from the Powerline service (same Google Workspace info@ account) — read via `list_variables` on Powerline, set on new service. Generate domain, wait for deploy, curl live `/` and POST `/api/book` with a test submission (real email sent to info@ — subject prefixed `[TEST]`).
- [ ] Step 4: Record deploy URL + open items in README and memory.
