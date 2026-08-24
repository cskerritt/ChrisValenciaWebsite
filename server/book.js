// Booking API for the Chris Valencia site: validation (zod), email composition,
// attachment handling (multer memory storage + sharp downscale), optional
// Cloudflare Turnstile verification, and the Express handler itself.
//
// FORM CONTRACT — src/components/BookingForm.astro must match this:
//   POST /api/book   multipart/form-data (urlencoded or JSON also accepted when there are no files)
//   text fields      name, email, phone (optional), idea, placement, size, budget, timing, consent="on"
//   honeypot         website   (hidden; must stay empty — anything in it is silently dropped)
//   files            references (up to MAX_FILES images, MAX_FILE_BYTES each; JPEG/PNG/GIF/WebP/HEIC)
//   turnstile        cf-turnstile-response (only required when the server has TURNSTILE_SECRET)
//
//   JSON clients (Accept: application/json, curl, fetch):
//     200 {ok:true} · 400 {ok:false,message,errors?} · 502/503 {ok:false,message}
//   Browser form posts (Accept prefers text/html — the no-JS fallback):
//     303 → /thanks/ on success · same status codes with a small HTML notice on error
//
// createBookHandler(deps) reads `deps.sendMail` / `deps.mailTo` at request time, so
// server/index.js can hand it a deps object at boot and bind `sendMail` once SMTP verifies.

import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Contract constants
// ---------------------------------------------------------------------------

export const FILE_FIELD = 'references';
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
// Keeps the whole message under the 25 MB cap common to Google Workspace and
// most SMTP relays once attachments are base64-encoded (~35% overhead).
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const HONEYPOT_FIELD = 'website';
export const TURNSTILE_FIELD = 'cf-turnstile-response';
export const FORM_PATH = '/book/';
export const THANKS_PATH = '/thanks/';

export const SIZES = Object.freeze({
  palm: 'Palm-sized',
  hand: 'Hand-sized',
  'half-sleeve': 'Half sleeve',
  sleeve: 'Full sleeve',
  back: 'Back piece',
  other: 'Other / not sure yet',
});

// Budget ranges are what the client tells us they have in mind; they are not a
// price list. Chris quotes every piece at the consultation.
export const BUDGETS = Object.freeze({
  'under-300': 'Under $300',
  '300-600': '$300 to $600',
  '600-1200': '$600 to $1,200',
  '1200-plus': '$1,200 or more',
  unsure: 'Not sure yet',
});

export const TIMINGS = Object.freeze({
  asap: 'As soon as possible',
  '1-3-months': 'In the next 1 to 3 months',
  '3-plus-months': '3 or more months out',
  flexible: 'Flexible',
});

export const FIELD_LABELS = Object.freeze({
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  idea: 'Your idea',
  placement: 'Placement',
  size: 'Size',
  budget: 'Budget',
  timing: 'Timing',
  consent: 'Consent',
});

// Verified shop facts (plan § Global Constraints). Keep in sync with src/data/shop.json;
// the runtime image only ships dist/ + server/, so the server cannot read that file.
export const FALLBACK_CONTACT = Object.freeze({
  shopName: 'Powerline Tattoo',
  phone: '+1-401-369-7771',
  phoneDisplay: '(401) 369-7771',
  instagram: 'https://instagram.com/cvalencia7',
  instagramHandle: '@cvalencia7',
});

export const MESSAGES = Object.freeze({
  invalid: 'Please check the highlighted fields and try again.',
  unconfigured:
    'The booking form is not connected to email right now. Please call the shop or message Chris on Instagram and he will get back to you.',
  sendFailed:
    'We could not send your request just now. Nothing you typed was lost: please try again in a minute, or reach the shop by phone or Instagram.',
  turnstile: 'We could not verify that you are a person. Reload the page and try again.',
  fileType: 'Only image files can be attached (JPEG, PNG, GIF, WebP, or HEIC).',
  uploadFailed: 'We could not read that upload. Please try again with JPEG or PNG files.',
  tooLarge: 'That submission is too large. Trim the description or attach fewer images and try again.',
  badRequest: 'We could not read that submission. Please go back and try again.',
  tooMany: 'Too many requests from your connection. Please wait 15 minutes and try again, or call the shop.',
  notFound: 'Not found.',
  serverError: 'Something went wrong on our end. Please try again, or call the shop.',
});

const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/avif', '.avif'],
  ['image/bmp', '.bmp'],
  ['image/tiff', '.tif'],
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const collapseLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value);
const trimText = (value) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = (value) => (typeof value === 'string' && value.trim() === '' ? undefined : trimText(value));
const normalizeParagraphs = (value) =>
  typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : value;

const singleLine = (min, max, required, tooLong) =>
  z.preprocess(collapseLine, z.string({ error: required }).min(min, { error: required }).max(max, { error: tooLong }));

export const bookingSchema = z.object({
  name: singleLine(1, 80, 'Please tell us your name.', 'Please keep your name under 80 characters.'),
  email: z.preprocess(
    collapseLine,
    z
      .email({ error: 'Enter a valid email address so Chris can reply.' })
      .max(254, { error: 'That email address is too long.' }),
  ),
  phone: z.preprocess(
    blankToUndefined,
    z.string().max(30, { error: 'Please keep your phone number under 30 characters.' }).optional(),
  ),
  idea: z.preprocess(
    normalizeParagraphs,
    z
      .string({ error: 'Tell Chris a little about the tattoo you have in mind.' })
      .min(10, { error: 'Describe your idea in at least a sentence (10 or more characters).' })
      .max(2000, { error: 'Please keep the description under 2,000 characters.' }),
  ),
  placement: singleLine(
    1,
    80,
    'Where on the body would the tattoo go?',
    'Please keep the placement under 80 characters.',
  ),
  size: z.enum(Object.keys(SIZES), { error: 'Choose an approximate size.' }),
  budget: z.enum(Object.keys(BUDGETS), { error: 'Choose a budget range.' }),
  timing: z.enum(Object.keys(TIMINGS), { error: 'Choose a rough timeline.' }),
  consent: z.literal('on', { error: 'Please confirm the consent checkbox before sending.' }),
});

/**
 * Validate a raw form body.
 * @returns {{ok:true,data:object}|{ok:false,errors:Record<string,string[]>,formErrors:string[]}}
 */
export function validateBooking(body) {
  const input = body && typeof body === 'object' ? body : {};
  const result = bookingSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const { fieldErrors, formErrors } = z.flattenError(result.error);
  return { ok: false, errors: fieldErrors, formErrors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) {
    const mb = n / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const labelFor = (map, key) => map[key] ?? String(key ?? '');

/**
 * Turn an uploaded filename into something safe to put in an email:
 * no directories, no control characters, lowercase, hyphenated, capped length.
 */
export function sanitizeFilename(original, index = 0, ext = '') {
  const raw = typeof original === 'string' ? original : '';
  const base = raw.split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[^.]*$/, '');
  const clean = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const name = clean || `reference-${index + 1}`;
  return `${name}${ext}`;
}

function extensionFor(file) {
  const byMime = ALLOWED_MIME.get(String(file?.mimetype ?? '').toLowerCase());
  if (byMime) return byMime;
  const fromName = path.extname(String(file?.originalname ?? '')).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(fromName) ? fromName : '.bin';
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Downscale an image to a web-sized JPEG. Throws when sharp cannot decode the
 * buffer (HEIC without libheif, corrupt files, non-images).
 */
export async function optimizeImage(buffer, { maxEdge = 1600, quality = 82 } = {}) {
  const image = sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'error', animated: false });
  const meta = await image.metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  const content = await image
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { content, contentType: 'image/jpeg', ext: '.jpg', resized: longest > maxEdge };
}

/**
 * Convert multer memory-storage files into nodemailer-ready attachments.
 * Images that decode are downscaled (kept original when that would not help);
 * anything sharp cannot read is attached as uploaded. Files past the total
 * budget are listed but not attached, with a reason.
 */
export async function prepareAttachments(files, { maxTotalBytes = MAX_TOTAL_ATTACHMENT_BYTES, optimize = optimizeImage } = {}) {
  const list = Array.isArray(files) ? files : [];
  const out = [];
  let total = 0;

  for (const [index, file] of list.entries()) {
    const originalName = typeof file?.originalname === 'string' ? file.originalname : '';
    if (!Buffer.isBuffer(file?.buffer)) {
      out.push({ filename: sanitizeFilename(originalName, index, '.bin'), originalName, contentType: 'application/octet-stream', size: 0, skipped: 'could not be read' });
      continue;
    }

    let chosen = {
      content: file.buffer,
      contentType: String(file.mimetype ?? 'application/octet-stream').toLowerCase(),
      ext: extensionFor(file),
    };
    try {
      const processed = await optimize(file.buffer);
      if (processed.resized || processed.content.length < file.buffer.length) chosen = processed;
    } catch {
      // Keep the original bytes (for example HEIC, which prebuilt sharp cannot decode).
    }

    const filename = sanitizeFilename(originalName, index, chosen.ext);
    const size = chosen.content.length;
    if (total + size > maxTotalBytes) {
      out.push({
        filename,
        originalName,
        contentType: chosen.contentType,
        size,
        skipped: `too large to attach with the others; ${formatBytes(maxTotalBytes)} total limit`,
      });
      continue;
    }
    total += size;
    out.push({ filename, originalName, contentType: chosen.contentType, content: chosen.content, size });
  }

  return out;
}

/** multer instance: memory storage, plan limits, image-only filter. */
export function createUpload({ maxFileBytes = MAX_FILE_BYTES, maxFiles = MAX_FILES } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileBytes,
      files: maxFiles,
      fields: 40,
      fieldSize: 32 * 1024,
      parts: maxFiles + 40,
    },
    fileFilter(req, file, cb) {
      if (ALLOWED_MIME.has(String(file.mimetype ?? '').toLowerCase())) return cb(null, true);
      const err = new Error(MESSAGES.fileType);
      err.code = 'UNSUPPORTED_FILE_TYPE';
      err.status = 400;
      return cb(err);
    },
  });
}

/** Plain-language message for a multer (or fileFilter) error. */
export function multerErrorMessage(err, { maxFiles = MAX_FILES, maxFileBytes = MAX_FILE_BYTES } = {}) {
  switch (err?.code) {
    case 'LIMIT_FILE_SIZE':
      return `Each image needs to be ${formatBytes(maxFileBytes)} or smaller.`;
    case 'LIMIT_FILE_COUNT':
      return `You can attach up to ${maxFiles} images.`;
    case 'LIMIT_UNEXPECTED_FILE':
      return `You can attach up to ${maxFiles} images, sent in the "${FILE_FIELD}" field.`;
    case 'UNSUPPORTED_FILE_TYPE':
      return MESSAGES.fileType;
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_PART_COUNT':
      return MESSAGES.tooLarge;
    default:
      return MESSAGES.uploadFailed;
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Compose the notification email.
 * @param {object} data validated booking data
 * @param {Array} attachments output of prepareAttachments (may include skipped entries)
 * @param {{submittedAt?:Date, siteUrl?:string}} meta
 */
export function buildEmail(data, attachments = [], meta = {}) {
  const submittedAt = meta.submittedAt instanceof Date ? meta.submittedAt : new Date();
  const list = Array.isArray(attachments) ? attachments : [];
  const attached = list.filter((a) => !a.skipped);
  const skipped = list.filter((a) => a.skipped);
  const phone = data.phone || '';

  const subject = `Booking request — ${data.name} — ${data.placement}`;

  const rows = [
    ['Name', data.name],
    ['Email', data.email, `mailto:${data.email}`],
    ['Phone', phone || 'not provided', phone ? `tel:${phone}` : undefined],
    ['Placement', data.placement],
    ['Size', labelFor(SIZES, data.size)],
    ['Budget', labelFor(BUDGETS, data.budget)],
    ['Timing', labelFor(TIMINGS, data.timing)],
  ];

  const describe = (a, i) =>
    a.skipped
      ? `${i + 1}. ${a.originalName || a.filename} — not attached (${a.skipped})`
      : `${i + 1}. ${a.filename} (${formatBytes(a.size)}, ${a.contentType})${
          a.originalName && a.originalName !== a.filename ? ` — uploaded as ${a.originalName}` : ''
        }`;

  const referenceSummary =
    list.length === 0
      ? 'none'
      : `${attached.length} attached${skipped.length ? `, ${skipped.length} not attached` : ''}`;

  const source = meta.siteUrl ? `${String(meta.siteUrl).replace(/\/+$/, '')}${FORM_PATH}` : '';

  const text = [
    'New booking request from the website form.',
    '',
    ...rows.map(([label, value]) => `${`${label}:`.padEnd(12)}${value}`),
    '',
    'Idea',
    '----',
    data.idea,
    '',
    `References: ${referenceSummary}`,
    ...list.map((a, i) => `  ${describe(a, i)}`),
    '',
    'Consent:    checked',
    `Submitted:  ${submittedAt.toISOString()}`,
    source ? `Source:     ${source}` : null,
    '',
    `Reply to this email to answer ${data.name} directly.`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const rowHtml = rows
    .map(
      ([label, value, href]) =>
        `<tr><th align="left" style="padding:6px 16px 6px 0;vertical-align:top;white-space:nowrap;font-weight:600;color:#4A443D">${escapeHtml(label)}</th>` +
        `<td style="padding:6px 0">${href ? `<a href="${escapeHtml(href)}" style="color:#A82A12">${escapeHtml(value)}</a>` : escapeHtml(value)}</td></tr>`,
    )
    .join('\n');

  const referencesHtml =
    list.length === 0
      ? '<p style="margin:0;color:#4A443D">None attached.</p>'
      : `<ol style="margin:0;padding-left:20px">${list
          .map((a, i) => `<li style="margin:2px 0">${escapeHtml(describe(a, i).replace(/^\d+\.\s/, ''))}</li>`)
          .join('')}</ol>`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#F4EDE0;color:#161412;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#FFFDF8;border:1px solid #C9BEA8;padding:24px 28px">
<p style="margin:0 0 4px;font:italic 13px Georgia,'Times New Roman',serif;color:#5E6B52">Booking request &middot; via the website form</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25">${escapeHtml(data.name)} &mdash; ${escapeHtml(data.placement)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
${rowHtml}
</table>
<h2 style="font-size:16px;margin:20px 0 6px">Idea</h2>
<p style="white-space:pre-wrap;margin:0">${escapeHtml(data.idea)}</p>
<h2 style="font-size:16px;margin:20px 0 6px">References (${escapeHtml(referenceSummary)})</h2>
${referencesHtml}
<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid #C9BEA8;color:#4A443D;font-size:13px">Consent checked. Submitted ${escapeHtml(submittedAt.toISOString())}${source ? ` from ${escapeHtml(source)}` : ''}. Reply to this email to answer ${escapeHtml(data.name)} directly.</p>
</div>
</body>
</html>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile
// ---------------------------------------------------------------------------

export function createTurnstileVerifier({
  secret,
  fetch = globalThis.fetch,
  url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  timeoutMs = 8000,
} = {}) {
  if (!secret) throw new TypeError('createTurnstileVerifier needs a secret');
  return async function verifyTurnstile(token, remoteip) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return false;
    try {
      const params = new URLSearchParams({ secret, response: token });
      if (remoteip) params.set('remoteip', String(remoteip));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res?.ok) return false;
      const json = await res.json();
      return json?.success === true;
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Browser form posts prefer HTML; fetch/curl/JSON clients get JSON. */
export function prefersHtml(req) {
  return typeof req?.accepts === 'function' && req.accepts(['json', 'html']) === 'html';
}

function titleFor(status) {
  switch (status) {
    case 400:
      return 'Check the form';
    case 413:
      return 'That was too large';
    case 429:
      return 'Slow down a moment';
    case 502:
      return 'Message not sent';
    case 503:
      return 'The form is offline';
    default:
      return 'Something went wrong';
  }
}

/**
 * Minimal, self-contained notice page for the no-JS path. Uses the Flash-Sheet
 * tokens inline (no external requests) and links back to the form plus the
 * verified shop phone and Instagram as a fallback.
 */
export function renderHtmlNotice({ status = 500, title, message = MESSAGES.serverError, errors, contact = FALLBACK_CONTACT } = {}) {
  const heading = title || titleFor(status);
  const items = Object.entries(errors ?? {})
    .flatMap(([field, msgs]) => (Array.isArray(msgs) ? msgs : [msgs]).map((m) => [field, m]))
    .map(
      ([field, m]) =>
        `<li><strong>${escapeHtml(FIELD_LABELS[field] ?? field)}:</strong> ${escapeHtml(m)}</li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(heading)} · Chris Valencia Tattoo</title>
<style>
:root{--paper:#F4EDE0;--ink:#161412;--ink-2:#4A443D;--accent:#D63A1E;--accent-ink:#A82A12;--sage:#5E6B52;--rule:#C9BEA8}
@media (prefers-color-scheme:dark){:root{--paper:#141210;--ink:#F1EAD9;--ink-2:#B8AE9C;--accent:#FF5A3C;--accent-ink:#FF5A3C;--rule:#3A342C}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper);color:var(--ink);font:17px/1.55 "Inter Tight","Helvetica Neue",Arial,sans-serif}
main{position:relative;max-width:560px;width:100%;padding:36px 32px;border:1px solid var(--rule)}
main::before,main::after{content:"";position:absolute;width:14px;height:14px;border:1px solid var(--ink-2)}
main::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
main::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.no{margin:0 0 6px;font:italic 15px Georgia,"Times New Roman",serif;color:var(--sage)}
h1{margin:0 0 12px;font-size:1.9rem;line-height:1.1;letter-spacing:-.01em}
p{margin:0 0 14px}
ul{margin:0 0 18px;padding-left:22px}
li{margin:4px 0}
a{color:var(--accent-ink);text-underline-offset:3px}
.btn{display:inline-block;min-height:44px;padding:11px 20px;margin:4px 0 18px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;border-radius:2px}
.btn:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.alt{color:var(--ink-2);font-size:.95rem;padding-top:14px;border-top:1px solid var(--rule)}
</style>
</head>
<body>
<main>
<p class="no">No. ${escapeHtml(status)}</p>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(message)}</p>
${items ? `<ul>${items}</ul>` : ''}
<a class="btn" href="${FORM_PATH}">Back to the booking form</a>
<p class="alt">Prefer to skip the form? Call ${escapeHtml(contact.shopName)} at <a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phoneDisplay)}</a> or message Chris on <a href="${escapeHtml(contact.instagram)}" rel="noopener">Instagram ${escapeHtml(contact.instagramHandle)}</a>.</p>
</main>
</body>
</html>
`;
}

/** Send a failure the way the client wants it (JSON or HTML notice). */
export function sendFailure(req, res, status, message, errors, contact = FALLBACK_CONTACT) {
  if (prefersHtml(req)) {
    return res.status(status).type('html').send(renderHtmlNotice({ status, message, errors, contact }));
  }
  const body = { ok: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
}

export function sendSuccess(req, res) {
  if (prefersHtml(req)) return res.redirect(303, THANKS_PATH);
  return res.status(200).json({ ok: true });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {(message:object)=>Promise<unknown>} [deps.sendMail]  bound once SMTP verifies; read per request
 * @param {string} [deps.mailTo]                              destination inbox
 * @param {string} [deps.mailFrom]                            From address (defaults to mailTo)
 * @param {(token:string, ip?:string)=>Promise<boolean>} [deps.verifyTurnstile]
 * @param {string} [deps.siteUrl]
 * @param {object} [deps.contact]                             overrides FALLBACK_CONTACT
 * @param {object} [deps.logger]
 * @param {(files:Array)=>Promise<Array>} [deps.prepareAttachments]
 */
export function createBookHandler(deps) {
  if (!deps || typeof deps !== 'object') throw new TypeError('createBookHandler(deps) expects an object');

  return async function bookHandler(req, res) {
    const logger = deps.logger ?? console;
    const contact = deps.contact ?? FALLBACK_CONTACT;
    const body = req?.body && typeof req.body === 'object' ? req.body : {};
    const files = Array.isArray(req?.files) ? req.files : [];

    try {
      // 1. Honeypot: bots that fill the hidden field get a convincing success and nothing else.
      const trap = body[HONEYPOT_FIELD];
      if (typeof trap === 'string' && trap.trim() !== '') {
        logger.info?.('[book] honeypot tripped; request dropped');
        return sendSuccess(req, res);
      }

      // 2. Transport readiness. Answer before validating so an unconfigured deploy
      //    is obvious from any request (the curl smoke test relies on this).
      if (typeof deps.sendMail !== 'function' || !deps.mailTo) {
        logger.warn?.('[book] request received but mail is not configured (SMTP unverified or MAIL_TO missing)');
        return sendFailure(req, res, 503, MESSAGES.unconfigured, undefined, contact);
      }

      // 3. Validate.
      const result = validateBooking(body);
      if (!result.ok) return sendFailure(req, res, 400, MESSAGES.invalid, result.errors, contact);
      const data = result.data;

      // 4. Turnstile, only when the server was given a secret.
      if (typeof deps.verifyTurnstile === 'function') {
        const token = body[TURNSTILE_FIELD];
        const passed = typeof token === 'string' && token.length > 0 && (await deps.verifyTurnstile(token, req?.ip));
        if (!passed) {
          logger.info?.('[book] turnstile verification failed');
          return sendFailure(req, res, 400, MESSAGES.turnstile, undefined, contact);
        }
      }

      // 5. Attachments + email.
      const prepare = typeof deps.prepareAttachments === 'function' ? deps.prepareAttachments : prepareAttachments;
      const attachments = await prepare(files);
      const email = buildEmail(data, attachments, { submittedAt: new Date(), siteUrl: deps.siteUrl });

      await deps.sendMail({
        from: { name: 'Chris Valencia Tattoo website', address: deps.mailFrom || deps.mailTo },
        to: deps.mailTo,
        replyTo: { name: data.name, address: data.email },
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: attachments
          .filter((a) => !a.skipped)
          .map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });

      logger.info?.(
        `[book] booking request sent for "${data.name}" (${data.placement}; ${attachments.filter((a) => !a.skipped).length} attachment(s)) to ${deps.mailTo}`,
      );
      return sendSuccess(req, res);
    } catch (err) {
      logger.error?.('[book] failed to send booking request:', err?.message ?? err);
      return sendFailure(req, res, 502, MESSAGES.sendFailed, undefined, contact);
    }
  };
}
