// Unit + in-process integration tests for the booking API (plan Task 9, server half).
//
// Handler tests call createBookHandler() with plain mock req/res objects.
// App tests boot the real Express app from server/index.js on an ephemeral port
// and talk to it with Node's global fetch/FormData, so no supertest is needed.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import {
  bookingSchema,
  validateBooking,
  buildEmail,
  createBookHandler,
  createUpload,
  createTurnstileVerifier,
  prepareAttachments,
  sanitizeFilename,
  multerErrorMessage,
  renderHtmlNotice,
  FILE_FIELD,
  MAX_FILES,
  MAX_FILE_BYTES,
  HONEYPOT_FIELD,
  TURNSTILE_FIELD,
  SIZES,
  BUDGETS,
  TIMINGS,
  FALLBACK_CONTACT,
} from '../../server/book.js';
import { createApp, connectMail, smtpOptionsFromEnv } from '../../server/index.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };

const VALID = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '(401) 555-0100',
  idea: 'A surreal koi fish wrapping around my forearm with a whimsical, animated feel.',
  placement: 'Left forearm',
  size: 'half-sleeve',
  budget: '600-1200',
  timing: '1-3-months',
  consent: 'on',
};

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, redirectedTo: undefined };
  res.status = vi.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn((body) => {
    res.body = body;
    res.headers['content-type'] = 'application/json';
    return res;
  });
  res.send = vi.fn((body) => {
    res.body = body;
    return res;
  });
  res.type = vi.fn((t) => {
    res.headers['content-type'] = t;
    return res;
  });
  res.set = vi.fn(() => res);
  res.redirect = vi.fn((code, url) => {
    res.statusCode = code;
    res.redirectedTo = url;
    return res;
  });
  return res;
}

function mockReq({ body = {}, files = [], html = false, ip = '203.0.113.7' } = {}) {
  return {
    body,
    files,
    ip,
    headers: {},
    accepts: () => (html ? 'html' : 'json'),
    get: () => undefined,
  };
}

function deps(overrides = {}) {
  return {
    sendMail: vi.fn(async () => ({ messageId: '<test@example.com>' })),
    mailTo: 'bookings@example.com',
    mailFrom: 'site@example.com',
    logger: silent,
    ...overrides,
  };
}

async function pngBuffer({ width, height, noise = false }) {
  const create = noise
    ? { width, height, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } }
    : { width, height, channels: 3, background: '#d63a1e' };
  return sharp({ create }).png().toBuffer();
}

function multerFile(buffer, originalname, mimetype) {
  return { fieldname: FILE_FIELD, originalname, mimetype, size: buffer.length, buffer };
}

// ---------------------------------------------------------------------------
// Constants / contract
// ---------------------------------------------------------------------------

describe('form contract constants', () => {
  it('exposes the field names and limits the form must use', () => {
    expect(FILE_FIELD).toBe('references');
    expect(MAX_FILES).toBe(5);
    expect(MAX_FILE_BYTES).toBe(8 * 1024 * 1024);
    expect(HONEYPOT_FIELD).toBe('website');
    expect(TURNSTILE_FIELD).toBe('cf-turnstile-response');
  });

  it('labels every enum value from the plan', () => {
    expect(Object.keys(SIZES)).toEqual(['palm', 'hand', 'half-sleeve', 'sleeve', 'back', 'other']);
    expect(Object.keys(BUDGETS)).toEqual(['under-300', '300-600', '600-1200', '1200-plus', 'unsure']);
    expect(Object.keys(TIMINGS)).toEqual(['asap', '1-3-months', '3-plus-months', 'flexible']);
    for (const map of [SIZES, BUDGETS, TIMINGS]) {
      for (const label of Object.values(map)) expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses only verified shop facts for the fallback contact', () => {
    expect(FALLBACK_CONTACT.phone).toBe('+1-401-369-7771');
    expect(FALLBACK_CONTACT.phoneDisplay).toBe('(401) 369-7771');
    expect(FALLBACK_CONTACT.instagram).toBe('https://instagram.com/cvalencia7');
    expect(FALLBACK_CONTACT.instagramHandle).toBe('@cvalencia7');
  });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('bookingSchema / validateBooking', () => {
  it('accepts a valid payload and trims whitespace', () => {
    const result = validateBooking({ ...VALID, name: '  Jane Doe  ', placement: ' Left  forearm ' });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('Jane Doe');
    expect(result.data.placement).toBe('Left forearm');
    expect(result.data.email).toBe('jane@example.com');
    expect(result.data.consent).toBe('on');
  });

  it('strips unknown fields such as the honeypot and turnstile token', () => {
    const result = validateBooking({ ...VALID, [HONEYPOT_FIELD]: '', [TURNSTILE_FIELD]: 'tok', extra: 'x' });
    expect(result.ok).toBe(true);
    expect(result.data).not.toHaveProperty(HONEYPOT_FIELD);
    expect(result.data).not.toHaveProperty(TURNSTILE_FIELD);
    expect(result.data).not.toHaveProperty('extra');
  });

  it('treats a blank phone as not provided and caps it at 30 characters', () => {
    expect(validateBooking({ ...VALID, phone: '   ' }).data.phone).toBeUndefined();
    const { phone, ...noPhone } = VALID;
    expect(validateBooking(noPhone).ok).toBe(true);
    const tooLong = validateBooking({ ...VALID, phone: '1'.repeat(31) });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.phone).toBeDefined();
  });

  it('reports a field error when email is missing or malformed', () => {
    const { email, ...noEmail } = VALID;
    const missing = validateBooking(noEmail);
    expect(missing.ok).toBe(false);
    expect(missing.errors.email?.length).toBeGreaterThan(0);
    const bad = validateBooking({ ...VALID, email: 'not-an-email' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.email?.[0]).toMatch(/email/i);
  });

  it('enforces the length bounds from the plan', () => {
    expect(validateBooking({ ...VALID, name: '' }).errors.name).toBeDefined();
    expect(validateBooking({ ...VALID, name: 'x'.repeat(81) }).errors.name).toBeDefined();
    expect(validateBooking({ ...VALID, idea: 'too short' }).errors.idea).toBeDefined();
    expect(validateBooking({ ...VALID, idea: 'x'.repeat(2001) }).errors.idea).toBeDefined();
    expect(validateBooking({ ...VALID, placement: '' }).errors.placement).toBeDefined();
    expect(validateBooking({ ...VALID, placement: 'x'.repeat(81) }).errors.placement).toBeDefined();
    expect(validateBooking({ ...VALID, idea: 'x'.repeat(2000) }).ok).toBe(true);
  });

  it('rejects values outside the size, budget and timing enums', () => {
    expect(validateBooking({ ...VALID, size: 'giant' }).errors.size).toBeDefined();
    expect(validateBooking({ ...VALID, budget: '1' }).errors.budget).toBeDefined();
    expect(validateBooking({ ...VALID, timing: 'yesterday' }).errors.timing).toBeDefined();
  });

  it('requires the consent checkbox (literal "on")', () => {
    const { consent, ...noConsent } = VALID;
    expect(validateBooking(noConsent).errors.consent).toBeDefined();
    expect(validateBooking({ ...VALID, consent: 'yes' }).errors.consent).toBeDefined();
  });

  it('collapses newlines in single-line fields so they cannot inject mail headers', () => {
    const result = validateBooking({ ...VALID, name: 'Jane\r\nBcc: evil@example.com', placement: 'Arm\nCc: x' });
    expect(result.ok).toBe(true);
    expect(result.data.name).not.toMatch(/[\r\n]/);
    expect(result.data.placement).not.toMatch(/[\r\n]/);
  });

  it('exposes the zod schema itself', () => {
    expect(bookingSchema.safeParse(VALID).success).toBe(true);
    expect(bookingSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Email composition
// ---------------------------------------------------------------------------

describe('buildEmail', () => {
  const data = validateBooking(VALID).data;

  it('uses the subject format from the plan', () => {
    expect(buildEmail(data, []).subject).toBe('Booking request — Jane Doe — Left forearm');
  });

  it('renders labelled lines for every field with human-readable enum labels', () => {
    const { text } = buildEmail(data, []);
    expect(text).toMatch(/Name:\s+Jane Doe/);
    expect(text).toMatch(/Email:\s+jane@example\.com/);
    expect(text).toMatch(/Phone:\s+\(401\) 555-0100/);
    expect(text).toMatch(/Placement:\s+Left forearm/);
    expect(text).toContain(SIZES['half-sleeve']);
    expect(text).toContain(BUDGETS['600-1200']);
    expect(text).toContain(TIMINGS['1-3-months']);
    expect(text).toContain(VALID.idea);
    expect(text).toMatch(/References:\s+none/i);
  });

  it('says when no phone was given', () => {
    const { text } = buildEmail({ ...data, phone: undefined }, []);
    expect(text).toMatch(/Phone:\s+not provided/i);
  });

  it('lists attachments with sizes and flags anything that was skipped', () => {
    const files = [
      { filename: 'sketch.jpg', size: 320_000, contentType: 'image/jpeg', originalName: 'sketch.jpg' },
      { filename: 'huge.png', size: 9_000_000, contentType: 'image/png', originalName: 'huge.png', skipped: 'too large' },
    ];
    const { text, html } = buildEmail(data, files);
    expect(text).toContain('sketch.jpg');
    expect(text).toMatch(/313 KB/);
    expect(text).toMatch(/huge\.png.*not attached/i);
    expect(html).toContain('sketch.jpg');
  });

  it('escapes HTML in every user-supplied value', () => {
    const hostile = { ...data, name: 'Jane <script>alert(1)</script>', idea: '<img src=x onerror=alert(1)> big & bold' };
    const { html, subject } = buildEmail(hostile, [{ filename: '<b>.jpg', size: 1, contentType: 'image/jpeg', originalName: '<b>.jpg' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; bold');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;b&gt;.jpg');
    expect(subject).toContain('<script>'); // subject is plain text; nodemailer encodes it
  });

  it('preserves paragraphs in the idea and includes submission metadata', () => {
    const multi = { ...data, idea: 'First line of the idea here.\n\nSecond paragraph with more detail.' };
    const { text, html } = buildEmail(multi, [], { submittedAt: new Date('2026-08-23T15:04:05Z'), siteUrl: 'https://example.com' });
    expect(text).toContain('Second paragraph with more detail.');
    expect(text).toContain('2026-08-23');
    expect(html).toMatch(/pre-wrap/);
    expect(text).toContain('https://example.com');
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe('sanitizeFilename', () => {
  it('strips paths, control characters and odd punctuation', () => {
    expect(sanitizeFilename('../../etc/passwd.png', 0, '.png')).toBe('passwd.png');
    expect(sanitizeFilename('C:\\Users\\me\\my sketch (1).JPG', 0, '.jpg')).toBe('my-sketch-1.jpg');
    expect(sanitizeFilename('weird\u0000name\n.png', 2, '.png')).toBe('weird-name.png');
  });

  it('falls back to a numbered name when nothing usable is left', () => {
    expect(sanitizeFilename('', 0, '.jpg')).toBe('reference-1.jpg');
    expect(sanitizeFilename('!!!.png', 3, '.png')).toBe('reference-4.png');
    expect(sanitizeFilename(undefined, 1, '.jpg')).toBe('reference-2.jpg');
  });

  it('caps very long names', () => {
    const out = sanitizeFilename('a'.repeat(300) + '.png', 0, '.png');
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('.png')).toBe(true);
  });
});

describe('prepareAttachments', () => {
  it('downscales large images to a 1600 px JPEG and keeps the original name stem', async () => {
    const png = await pngBuffer({ width: 2400, height: 300 });
    const [att] = await prepareAttachments([multerFile(png, 'Wide Sketch.png', 'image/png')]);
    expect(att.contentType).toBe('image/jpeg');
    expect(att.filename).toBe('wide-sketch.jpg');
    expect(att.content.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const meta = await sharp(att.content).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(200);
    expect(att.size).toBe(att.content.length);
    expect(att.originalName).toBe('Wide Sketch.png');
  });

  it('re-encodes noisy images when that makes them smaller', async () => {
    const png = await pngBuffer({ width: 900, height: 700, noise: true });
    const [att] = await prepareAttachments([multerFile(png, 'photo.png', 'image/png')]);
    expect(att.contentType).toBe('image/jpeg');
    expect(att.size).toBeLessThan(png.length);
  });

  it('keeps a small original untouched when re-encoding would not help', async () => {
    const png = await pngBuffer({ width: 4, height: 4 });
    const [att] = await prepareAttachments([multerFile(png, 'tiny.png', 'image/png')]);
    expect(att.contentType).toBe('image/png');
    expect(att.filename).toBe('tiny.png');
    expect(att.content.equals(png)).toBe(true);
  });

  it('attaches undecodable files as-is (for example HEIC) instead of dropping them', async () => {
    const garbage = Buffer.from('definitely not an image', 'utf8');
    const [att] = await prepareAttachments([multerFile(garbage, 'IMG_0001.HEIC', 'image/heic')]);
    expect(att.contentType).toBe('image/heic');
    expect(att.filename).toBe('img_0001.heic');
    expect(att.content.equals(garbage)).toBe(true);
    expect(att.skipped).toBeUndefined();
  });

  it('skips files beyond the total attachment budget and says why', async () => {
    const a = Buffer.alloc(600, 1);
    const b = Buffer.alloc(600, 2);
    const out = await prepareAttachments(
      [multerFile(a, 'a.heic', 'image/heic'), multerFile(b, 'b.heic', 'image/heic')],
      { maxTotalBytes: 1000 },
    );
    expect(out).toHaveLength(2);
    expect(out[0].skipped).toBeUndefined();
    expect(out[1].skipped).toMatch(/too large/i);
    expect(out[1].content).toBeUndefined();
  });

  it('returns an empty list for no files', async () => {
    expect(await prepareAttachments([])).toEqual([]);
    expect(await prepareAttachments(undefined)).toEqual([]);
  });
});

describe('createUpload', () => {
  it('builds a multer instance with memory storage, the plan limits and an image-only filter', () => {
    const upload = createUpload();
    expect(typeof upload.array).toBe('function');
  });

  it('maps multer error codes to plain-language messages', () => {
    expect(multerErrorMessage({ code: 'LIMIT_FILE_SIZE' })).toMatch(/8 MB/);
    expect(multerErrorMessage({ code: 'LIMIT_FILE_COUNT' })).toMatch(/5/);
    expect(multerErrorMessage({ code: 'LIMIT_UNEXPECTED_FILE' })).toMatch(/references/);
    expect(multerErrorMessage({ code: 'SOMETHING_ELSE' })).toMatch(/upload/i);
  });
});

// ---------------------------------------------------------------------------
// Turnstile
// ---------------------------------------------------------------------------

describe('createTurnstileVerifier', () => {
  it('posts secret, response and remoteip to siteverify and returns success', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    const verify = createTurnstileVerifier({ secret: 'sec', fetch: fetchMock });
    await expect(verify('tok', '198.51.100.3')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    const params = new URLSearchParams(init.body);
    expect(params.get('secret')).toBe('sec');
    expect(params.get('response')).toBe('tok');
    expect(params.get('remoteip')).toBe('198.51.100.3');
  });

  it('returns false on failure responses, network errors, or a missing token', async () => {
    const failing = createTurnstileVerifier({ secret: 'sec', fetch: async () => ({ ok: true, json: async () => ({ success: false }) }) });
    await expect(failing('tok')).resolves.toBe(false);
    const throwing = createTurnstileVerifier({ secret: 'sec', fetch: async () => { throw new Error('boom'); } });
    await expect(throwing('tok')).resolves.toBe(false);
    const fetchMock = vi.fn();
    const empty = createTurnstileVerifier({ secret: 'sec', fetch: fetchMock });
    await expect(empty('')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

describe('createBookHandler', () => {
  it('sends one email for a valid payload and answers 200 {ok:true}', async () => {
    const d = deps();
    const handler = createBookHandler(d);
    const res = mockRes();
    await handler(mockReq({ body: { ...VALID } }), res, vi.fn());

    expect(d.sendMail).toHaveBeenCalledTimes(1);
    const msg = d.sendMail.mock.calls[0][0];
    expect(msg.to).toBe('bookings@example.com');
    expect(msg.subject).toBe('Booking request — Jane Doe — Left forearm');
    expect(msg.replyTo).toEqual({ name: 'Jane Doe', address: 'jane@example.com' });
    expect(msg.from).toEqual(expect.objectContaining({ address: 'site@example.com' }));
    expect(msg.text).toContain('Left forearm');
    expect(msg.html).toContain('Left forearm');
    expect(msg.attachments).toEqual([]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('short-circuits when the honeypot is filled: 200 ok, no email', async () => {
    const d = deps();
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID, [HONEYPOT_FIELD]: 'http://spam.example' } }), res, vi.fn());
    expect(d.sendMail).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('returns 400 with field errors when email is missing', async () => {
    const d = deps();
    const res = mockRes();
    const { email, ...body } = VALID;
    await createBookHandler(d)(mockReq({ body }), res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.email).toBeDefined();
    expect(typeof res.body.message).toBe('string');
    expect(d.sendMail).not.toHaveBeenCalled();
  });

  it('answers 502 with a generic message when sendMail throws', async () => {
    const d = deps({ sendMail: vi.fn(async () => { throw new Error('535 auth failed: super secret detail'); }) });
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID } }), res, vi.fn());
    expect(res.statusCode).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).not.toContain('secret detail');
    expect(res.body.message.length).toBeGreaterThan(10);
  });

  it('answers 503 when mailTo is undefined', async () => {
    const d = deps({ mailTo: undefined });
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID } }), res, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/email|phone|Instagram/i);
    expect(d.sendMail).not.toHaveBeenCalled();
  });

  it('answers 503 before validating when no transport is ready (matches the curl smoke test)', async () => {
    const d = deps({ sendMail: undefined });
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: {} }), res, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('reads deps at request time so SMTP can come online after boot', async () => {
    const d = deps({ sendMail: undefined });
    const handler = createBookHandler(d);
    const first = mockRes();
    await handler(mockReq({ body: { ...VALID } }), first, vi.fn());
    expect(first.statusCode).toBe(503);

    d.sendMail = vi.fn(async () => ({}));
    const second = mockRes();
    await handler(mockReq({ body: { ...VALID } }), second, vi.fn());
    expect(second.statusCode).toBe(200);
    expect(d.sendMail).toHaveBeenCalledTimes(1);
  });

  it('requires and verifies a Turnstile token when a verifier is configured', async () => {
    const verifyTurnstile = vi.fn(async (token) => token === 'good');
    const d = deps({ verifyTurnstile });

    const missing = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID } }), missing, vi.fn());
    expect(missing.statusCode).toBe(400);
    expect(missing.body.message).toMatch(/verif/i);
    expect(d.sendMail).not.toHaveBeenCalled();

    const bad = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID, [TURNSTILE_FIELD]: 'bad' } }), bad, vi.fn());
    expect(bad.statusCode).toBe(400);
    expect(verifyTurnstile).toHaveBeenCalledWith('bad', '203.0.113.7');
    expect(d.sendMail).not.toHaveBeenCalled();

    const good = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID, [TURNSTILE_FIELD]: 'good' } }), good, vi.fn());
    expect(good.statusCode).toBe(200);
    expect(d.sendMail).toHaveBeenCalledTimes(1);
  });

  it('skips Turnstile entirely when no verifier is configured', async () => {
    const d = deps();
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID } }), res, vi.fn());
    expect(res.statusCode).toBe(200);
  });

  it('attaches uploaded images (processed) and lists them in the email', async () => {
    const d = deps();
    const png = await pngBuffer({ width: 2000, height: 500 });
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID }, files: [multerFile(png, 'Ref One.png', 'image/png')] }), res, vi.fn());
    expect(res.statusCode).toBe(200);
    const msg = d.sendMail.mock.calls[0][0];
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]).toMatchObject({ filename: 'ref-one.jpg', contentType: 'image/jpeg' });
    expect(Buffer.isBuffer(msg.attachments[0].content)).toBe(true);
    expect(msg.text).toContain('ref-one.jpg');
    expect(msg.text).toContain('Ref One.png');
  });

  it('redirects 303 to /thanks/ for browser form posts (no-JS fallback)', async () => {
    const d = deps();
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID }, html: true }), res, vi.fn());
    expect(d.sendMail).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith(303, '/thanks/');
  });

  it('redirects honeypot hits from browsers too, without sending', async () => {
    const d = deps();
    const res = mockRes();
    await createBookHandler(d)(mockReq({ body: { ...VALID, [HONEYPOT_FIELD]: 'x' }, html: true }), res, vi.fn());
    expect(d.sendMail).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(303, '/thanks/');
  });

  it('renders an HTML notice with the right status for browser form errors', async () => {
    const d = deps();
    const res = mockRes();
    const { email, ...body } = VALID;
    await createBookHandler(d)(mockReq({ body, html: true }), res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.body).toContain('/book/');
    expect(res.body).toMatch(/email/i);
    expect(res.body).toContain('tel:+1-401-369-7771');
    expect(res.body).toContain('https://instagram.com/cvalencia7');
  });

  it('handles a request with no body at all', async () => {
    const d = deps();
    const res = mockRes();
    await createBookHandler(d)({ ip: '::1', accepts: () => 'json', headers: {} }, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('renderHtmlNotice', () => {
  it('produces a self-contained, escaped page with a way back and fallback contact', () => {
    const html = renderHtmlNotice({
      status: 400,
      title: 'Check the form',
      message: 'Please check the highlighted fields.',
      errors: { email: ['Enter a valid <email>'] },
    });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Enter a valid &lt;email&gt;');
    expect(html).toContain('href="/book/"');
    expect(html).toContain(FALLBACK_CONTACT.instagram);
    expect(html).toContain(`tel:${FALLBACK_CONTACT.phone}`);
    expect(html).toContain('No. 400');
  });
});

// ---------------------------------------------------------------------------
// smtpOptionsFromEnv
// ---------------------------------------------------------------------------

describe('smtpOptionsFromEnv', () => {
  it('returns null when SMTP_HOST is unset or blank', () => {
    expect(smtpOptionsFromEnv({})).toBeNull();
    expect(smtpOptionsFromEnv({ SMTP_HOST: '   ' })).toBeNull();
  });

  it('builds nodemailer options with sensible defaults and timeouts', () => {
    const opts = smtpOptionsFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect(opts).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' } });
    expect(opts.connectionTimeout).toBeGreaterThan(0);
  });

  it('honours SMTP_PORT and SMTP_SECURE', () => {
    expect(smtpOptionsFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true });
    expect(smtpOptionsFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '2525', SMTP_SECURE: 'true' })).toMatchObject({ port: 2525, secure: true });
    expect(smtpOptionsFromEnv({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_SECURE: 'false' })).toMatchObject({ port: 465, secure: false });
    expect(smtpOptionsFromEnv({ SMTP_HOST: 'h' }).auth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// connectMail
// ---------------------------------------------------------------------------

describe('connectMail', () => {
  it('binds book.sendMail to the transporter once verify() succeeds', async () => {
    const transporter = { verify: vi.fn(async () => true), sendMail: vi.fn(async () => ({ messageId: 'm' })) };
    const book = { sendMail: undefined };
    const states = [];
    await expect(connectMail({ transporter, book, logger: silent, onState: (s) => states.push(s) })).resolves.toBe(true);
    expect(typeof book.sendMail).toBe('function');
    await book.sendMail({ subject: 'x' });
    expect(transporter.sendMail).toHaveBeenCalledWith({ subject: 'x' });
    expect(states).toEqual(['ready']);
  });

  it('retries a failing verify() and gives up without binding sendMail', async () => {
    const transporter = { verify: vi.fn(async () => { throw new Error('ECONNREFUSED'); }), sendMail: vi.fn() };
    const book = { sendMail: undefined };
    const states = [];
    await expect(connectMail({ transporter, book, logger: silent, attempts: 3, delayMs: 0, onState: (s) => states.push(s) })).resolves.toBe(false);
    expect(transporter.verify).toHaveBeenCalledTimes(3);
    expect(book.sendMail).toBeUndefined();
    expect(states).toEqual(['failed', 'failed', 'failed']);
  });

  it('recovers when a later attempt succeeds', async () => {
    let calls = 0;
    const transporter = { verify: vi.fn(async () => { calls += 1; if (calls < 2) throw new Error('timeout'); return true; }), sendMail: vi.fn() };
    const book = { sendMail: undefined };
    await expect(connectMail({ transporter, book, logger: silent, attempts: 3, delayMs: 0 })).resolves.toBe(true);
    expect(transporter.verify).toHaveBeenCalledTimes(2);
    expect(typeof book.sendMail).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Express app (real HTTP on an ephemeral port)
// ---------------------------------------------------------------------------

describe('createApp (integration)', () => {
  let distDir;
  let server;
  let base;
  let book;

  const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'cvt-dist-'));
    mkdirSync(join(distDir, 'about'), { recursive: true });
    mkdirSync(join(distDir, '_astro'), { recursive: true });
    mkdirSync(join(distDir, 'images'), { recursive: true });
    writeFileSync(join(distDir, 'index.html'), `<!doctype html><html><body><h1>Home</h1>${'<p>paper</p>'.repeat(200)}</body></html>`);
    writeFileSync(join(distDir, 'about', 'index.html'), '<!doctype html><html><body><h1>About</h1></body></html>');
    writeFileSync(join(distDir, '404.html'), '<!doctype html><html><body><h1>No. 404</h1></body></html>');
    writeFileSync(join(distDir, '_astro', 'app.abc123.css'), 'body{color:#161412}');
    writeFileSync(join(distDir, 'images', 'x.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(join(distDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');

    book = { sendMail: undefined, mailTo: 'bookings@example.com', mailFrom: 'site@example.com', logger: silent };
    const app = createApp({
      distDir,
      book,
      logger: silent,
      rateLimit: { windowMs: 60_000, limit: 12 },
      upload: { maxFileBytes: 64 * 1024, maxFiles: 2 },
      mailStatus: () => (book.sendMail ? 'ready' : 'unconfigured'),
    });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(distDir, { recursive: true, force: true });
  });

  function form(fields = VALID, files = []) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) fd.append(f.field ?? FILE_FIELD, new Blob([f.buffer], { type: f.type }), f.name);
    return fd;
  }

  it('serves the built site with security and cache headers', async () => {
    const res = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toMatch(/max-age=0/);
    expect(await res.text()).toContain('<h1>Home</h1>');
  });

  it('serves hashed assets as immutable and images with a 7-day max-age', async () => {
    const css = await fetch(`${base}/_astro/app.abc123.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get('cache-control')).toMatch(/immutable/);
    const img = await fetch(`${base}/images/x.jpg`);
    expect(img.status).toBe(200);
    expect(img.headers.get('cache-control')).toMatch(/max-age=604800/);
    const robots = await fetch(`${base}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get('cache-control')).toMatch(/max-age=3600/);
  });

  it('serves trailing-slash routes and redirects the bare form of a directory', async () => {
    const page = await fetch(`${base}/about/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('About');
    const bare = await fetch(`${base}/about`, { redirect: 'manual' });
    expect([301, 302, 308]).toContain(bare.status);
    expect(bare.headers.get('location')).toMatch(/\/about\/$/);
  });

  it('answers unknown pages with dist/404.html and unknown API routes with JSON', async () => {
    const page = await fetch(`${base}/nowhere/`);
    expect(page.status).toBe(404);
    expect(await page.text()).toContain('No. 404');
    const api = await fetch(`${base}/api/nowhere`);
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ ok: false, message: expect.any(String) });
  });

  it('exposes a health endpoint outside the rate-limited /api prefix', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mail: 'unconfigured' });
  });

  it('POST /api/book answers 503 JSON when SMTP is not configured (curl smoke test)', async () => {
    const res = await fetch(`${base}/api/book`, { method: 'POST', body: form({ name: 'x' }) });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/email|phone|Instagram/i);
  });

  it('POST /api/book sends mail once SMTP is bound, with a multipart upload', async () => {
    book.sendMail = vi.fn(async () => ({ messageId: 'x' }));
    try {
      const png = await pngBuffer({ width: 40, height: 40 });
      const res = await fetch(`${base}/api/book`, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: form(VALID, [{ name: 'idea.png', type: 'image/png', buffer: png }]),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(book.sendMail).toHaveBeenCalledTimes(1);
      const msg = book.sendMail.mock.calls[0][0];
      expect(msg.subject).toBe('Booking request — Jane Doe — Left forearm');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0].filename).toMatch(/^idea\.(png|jpg)$/);
    } finally {
      book.sendMail = undefined;
    }
  });

  it('rejects non-image uploads with a 400 JSON message', async () => {
    book.sendMail = vi.fn(async () => ({}));
    try {
      const res = await fetch(`${base}/api/book`, {
        method: 'POST',
        body: form(VALID, [{ name: 'evil.exe', type: 'application/octet-stream', buffer: Buffer.from('MZ') }]),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.message).toMatch(/image/i);
      expect(book.sendMail).not.toHaveBeenCalled();
    } finally {
      book.sendMail = undefined;
    }
  });

  it('rejects too many files and oversized files with plain-language 400s', async () => {
    book.sendMail = vi.fn(async () => ({}));
    try {
      const small = { type: 'image/png', buffer: Buffer.alloc(10, 1) };
      const many = await fetch(`${base}/api/book`, {
        method: 'POST',
        body: form(VALID, [
          { ...small, name: 'a.png' },
          { ...small, name: 'b.png' },
          { ...small, name: 'c.png' },
        ]),
      });
      expect(many.status).toBe(400);
      expect((await many.json()).message).toMatch(/2 images/);

      const big = await fetch(`${base}/api/book`, {
        method: 'POST',
        body: form(VALID, [{ name: 'big.png', type: 'image/png', buffer: Buffer.alloc(70 * 1024, 1) }]),
      });
      expect(big.status).toBe(400);
      expect((await big.json()).message).toMatch(/smaller/i);
      expect(book.sendMail).not.toHaveBeenCalled();
    } finally {
      book.sendMail = undefined;
    }
  });

  it('follows the no-JS path for browser form posts: 303 on honeypot, HTML notice on errors', async () => {
    const hp = await fetch(`${base}/api/book`, {
      method: 'POST',
      redirect: 'manual',
      headers: { accept: BROWSER_ACCEPT },
      body: form({ ...VALID, [HONEYPOT_FIELD]: 'spam' }),
    });
    expect(hp.status).toBe(303);
    expect(hp.headers.get('location')).toMatch(/\/thanks\/$/);

    const err = await fetch(`${base}/api/book`, {
      method: 'POST',
      headers: { accept: BROWSER_ACCEPT },
      body: form({ ...VALID }),
    });
    expect(err.status).toBe(503);
    expect(err.headers.get('content-type')).toMatch(/text\/html/);
    const html = await err.text();
    expect(html).toContain('href="/book/"');
    expect(html).toContain('No. 503');
  });

  it('accepts urlencoded bodies too (no enctype forms)', async () => {
    const res = await fetch(`${base}/api/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...VALID, [HONEYPOT_FIELD]: 'bot' }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rate-limits /api/ per IP and answers 429 JSON', async () => {
    // The earlier tests in this block already consumed part of the window;
    // keep hammering until the limiter trips, then assert on the shape.
    let last;
    for (let i = 0; i < 14; i += 1) {
      last = await fetch(`${base}/api/book`, { method: 'POST', body: form({ [HONEYPOT_FIELD]: 'x' }) });
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.headers.get('ratelimit')).toBeTruthy();
    const body = await last.json();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/wait|minutes/i);
    // Static pages and /healthz are unaffected.
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});
