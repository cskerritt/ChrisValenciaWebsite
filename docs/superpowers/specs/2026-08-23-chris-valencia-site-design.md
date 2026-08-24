# Chris Valencia Tattoo — Website Design Spec

Date: 2026-08-23 · Status: approved by Chris Skerritt (chat)

## 1. Goal

A standalone marketing site for tattoo artist **Chris Valencia** (resident artist at Powerline Tattoo, Cranston, RI) whose single job is to turn local search / AI-search traffic into booking requests sent to his inbox. Success = booking-form submissions.

Non-goals: e-commerce, blog CMS, live Instagram API, shop-wide content (that is powerlinetattoo.com's job).

## 2. Source facts (verified from `~/powerline-tattoo`)

- Name: Chris Valencia. Instagram: https://instagram.com/cvalencia7
- Shop: Powerline Tattoo, Cranston, RI (address/phone/hours copied from the Powerline repo at build time; keep in one `src/data/shop.json`).
- Bio (verbatim source, may be lightly edited): born/raised in a small West Texas town; tattooed there ~8 years; moved to Atlanta, GA area ~10 years ago; now full-time in Rhode Island. Works all styles; prefers illustrative, neo-traditional, new-school; "fun, surreal images with a very animated, whimsical feel."
- Assets: 32 portfolio PNGs (`public/images/gallery/chris-valencia/chris-01..32.png`), headshot `images/artists/chris-valencia.jpg`, video `https://www.youtube-nocookie.com/embed/PxfH5-cOwHo`.
- Booking email: `info@powerlinetattoo.com` for now; `MAIL_TO` env var swaps in Chris's address later.

**Unknown — must be flagged in copy, never invented:** hourly rate / shop minimum, deposit amount, consultation policy, walk-in policy, personal hours, years of experience as a number, testimonials.

## 3. Stack

- **Astro 5** (static output) + TypeScript; content collections for styles, locations, FAQ, portfolio manifest.
- **Node 22 / Express** server (`server/`) that serves `dist/` and exposes `POST /api/book` (multer upload ≤ 5 files × 8 MB, images only; nodemailer via SMTP env; honeypot field; `express-rate-limit` 6/15 min per IP; `helmet`; optional Cloudflare Turnstile when `TURNSTILE_SECRET` set).
- **Deploy:** Docker → Railway. Env: `SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS MAIL_TO SITE_URL TURNSTILE_SECRET(optional)`. Form returns 503 with a clear message when SMTP is unconfigured.
- Node 22 for installs (Node 25 npm bug).

## 4. Information architecture

| Route | Purpose |
|---|---|
| `/` | Hero, positioning, 8-piece flash grid, process, video, FAQ excerpt, CTA |
| `/portfolio/` | All pieces, filter by style, lightbox; JSON manifest `src/data/portfolio.json` (`file,title,style[],placement,alt,featured`) |
| `/about/` | Bio, video, shop context, Instagram |
| `/book/` | Booking form (name, email, phone, idea, placement, size, budget range, timing, references upload, consent) |
| `/styles/{illustrative,neo-traditional,new-school,cover-ups}/` | Style explainers, answer-first, linked pieces |
| `/tattoo-artist/{cranston,providence,warwick,johnston,west-warwick,east-providence,pawtucket,rhode-island}/` | Location pages with genuinely distinct content (drive time/route, parking, local references); each ≥ 350 unique words |
| `/faq/` | Question headings; FAQPage schema |
| `/aftercare/` | Step-by-step; HowTo schema |
| `/pricing/` | How quoting works; deposit/minimum shown as "confirm at consult" placeholders |
| `/thanks/` | Post-submit |
| `robots.txt`, `sitemap-index.xml`, `llms.txt`, `404` | |

Internal link mesh: every style page links all locations; every location page links all styles + portfolio + book; footer links all.

## 5. Visual identity — "Flash Sheet"

- Ground: cream paper `#F4EDE0` (dark mode: ink `#141210`); type ink `#161412`; accent vermilion `#D63A1E`; secondary sage `#5E6B52` used sparingly.
- Type: display **Bricolage Grotesque** (or **Anton** fallback) for headlines; **Fraunces** italic for pull-quotes/labels; body **Inter Tight**. Google Fonts, `display=swap`, preconnect.
- Ornaments: registration marks in corners of sections, halftone dot texture (CSS gradient, no images), numbered "sheet" labels (`No. 01`), hand-drawn rule via SVG.
- Gallery: flash-sheet layout — CSS grid with intentional irregular spans (2×2 hero tiles), thin ink borders, caption strip under each tile, not a masonry blob.
- Motion: reveal-on-scroll (visible by default when JS fails), hero piece cross-fade, respects `prefers-reduced-motion`.
- Accessibility: WCAG AA contrast, 44 px targets, skip link, focus-visible, lightbox keyboard/focus trap.
- Both themes defined on `:root` tokens; `prefers-color-scheme` + manual toggle stored in localStorage.

## 6. SEO / GEO / AEO

- Per-page `<title>`, meta description, canonical, OG/Twitter (absolute image), `robots`.
- JSON-LD: `Person` (Chris, `worksFor` → `TattooParlor` Powerline with address/geo/hours/sameAs Instagram), `WebSite`, `BreadcrumbList` on all inner pages, `FAQPage` (faq + home excerpt), `HowTo` (aftercare), `ImageObject` on portfolio items, `Service` on style pages with `areaServed` cities.
- Answer-first paragraphs (40–60 words) under every H1/H2 question; `speakable` on FAQ answers.
- `llms.txt` summarizing who/what/where/how to book.
- Image alt written per piece from the actual image (style, subject, placement).
- Copy passes through marketing-skills `ai-seo`, `copywriting`, `content-humanizer`, `schema-markup` checklists; no keyword stuffing; each location page unique.
- Sitemap via `@astrojs/sitemap`; `SITE_URL` env drives absolute URLs.

## 7. Testing & quality gates

- Vitest: form validation schema, mailer composition (mocked transport), rate-limit/honeypot paths.
- Playwright: every route 200 + has H1 + parseable JSON-LD; portfolio filter; form happy path + honeypot rejection; dark-mode toggle.
- Lighthouse CI on `/`, `/portfolio/`, `/book/`, one style, one location: ≥ 95 perf/a11y/best-practices/SEO.
- `docker build` + `docker run` locally, curl `/` and `/api/book` before push.
- Adversarial copy review agent: hunts invented facts, generic phrasing, duplicate location content.

## 8. Delivery

- Direct-to-main pushes after local Docker verification (owner's standard).
- Railway project created via MCP; env vars set; railway.app URL used until domain purchased.
- README documents adding photos (drop file + manifest entry), env vars, and the facts-to-confirm list for Chris.
