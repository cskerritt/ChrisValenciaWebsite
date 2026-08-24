// Express server: serves the static Astro build in dist/ and exposes POST /api/book.
//
//   node server/index.js
//
// Environment (all optional; without SMTP_* the form answers 503 with a clear message):
//   PORT              default 3000
//   SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS
//   MAIL_TO           destination inbox (default: the shop inbox, spec §2)
//   MAIL_FROM         From address (default: SMTP_USER, then MAIL_TO)
//   SITE_URL          public origin, used in the email footer
//   TURNSTILE_SECRET  enables Cloudflare Turnstile verification on /api/book
//
// createApp() is exported for tests; start() boots the real thing when run directly.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import nodemailer from 'nodemailer';

import {
  createBookHandler,
  createTurnstileVerifier,
  createUpload,
  multerErrorMessage,
  sendFailure,
  FILE_FIELD,
  MAX_FILES,
  MESSAGES,
} from './book.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIST_DIR = path.resolve(HERE, '..', 'dist');
// Spec §2: booking email goes to the shop inbox until MAIL_TO points at Chris's own address.
export const DEFAULT_MAIL_TO = 'info@powerlinetattoo.com';

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 6;
const BODY_LIMIT = '64kb';

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/** nodemailer transport options from SMTP_* env vars, or null when SMTP_HOST is unset. */
export function smtpOptionsFromEnv(env = process.env) {
  const host = typeof env.SMTP_HOST === 'string' ? env.SMTP_HOST.trim() : '';
  if (!host) return null;
  const port = Number.parseInt(env.SMTP_PORT, 10) || 587;
  const secure =
    typeof env.SMTP_SECURE === 'string' && env.SMTP_SECURE.trim() !== ''
      ? /^(1|true|yes|on)$/i.test(env.SMTP_SECURE.trim())
      : port === 465;
  const user = typeof env.SMTP_USER === 'string' ? env.SMTP_USER.trim() : '';
  return {
    host,
    port,
    secure,
    auth: user ? { user, pass: env.SMTP_PASS ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

function cacheHeaders(res, filePath) {
  const rel = filePath.replace(/\\/g, '/');
  if (rel.includes('/_astro/')) {
    // Astro content-hashes everything under _astro/.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (rel.endsWith('.html')) {
    // Pages must pick up the next deploy immediately.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  } else if (/\.(xml|txt|json)$/i.test(rel)) {
    // sitemap, robots.txt, llms.txt
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
  // Everything else (images, favicon, fonts) keeps the 7-day maxAge from express.static.
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} [options.distDir]
 * @param {object} [options.book]        deps for createBookHandler (read per request)
 * @param {{windowMs?:number, limit?:number}} [options.rateLimit]
 * @param {{maxFileBytes?:number, maxFiles?:number}} [options.upload]
 * @param {object} [options.logger]
 * @param {number|boolean|string} [options.trustProxy]  Railway sits one proxy hop away
 * @param {() => string} [options.mailStatus]           reported by GET /healthz
 */
export function createApp({
  distDir = DEFAULT_DIST_DIR,
  book = {},
  rateLimit: rateOptions = {},
  upload: uploadLimits = {},
  logger = console,
  trustProxy = 1,
  mailStatus = () => (typeof book.sendMail === 'function' ? 'ready' : 'unconfigured'),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use(
    helmet({
      // The pages carry inline theme scripts, Google Fonts and a YouTube embed; CSP stays off (plan Task 9).
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // Public marketing assets (OG image, portfolio) may be embedded elsewhere.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Keep referrers for outbound clicks to Instagram / Powerline (browser default policy).
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());

  app.get('/healthz', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, mail: mailStatus() });
  });

  const limiter = rateLimit({
    windowMs: rateOptions.windowMs ?? RATE_WINDOW_MS,
    limit: rateOptions.limit ?? RATE_LIMIT,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => sendFailure(req, res, 429, MESSAGES.tooMany),
  });
  app.use('/api/', limiter);

  const maxFiles = uploadLimits.maxFiles ?? MAX_FILES;
  const upload = createUpload(uploadLimits);
  app.post(
    '/api/book',
    express.json({ limit: BODY_LIMIT }),
    express.urlencoded({ extended: false, limit: BODY_LIMIT }),
    upload.array(FILE_FIELD, maxFiles),
    createBookHandler(book),
  );
  app.all(['/api', '/api/*'], (req, res) => sendFailure(req, res, 404, MESSAGES.notFound));

  app.use(express.static(distDir, { extensions: ['html'], maxAge: '7d', setHeaders: cacheHeaders }));

  // 404: the Astro-built page when it exists, plain text otherwise.
  app.use((req, res) => {
    const page = path.join(distDir, '404.html');
    if (existsSync(page)) {
      res.status(404);
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(page, { cacheControl: false });
    }
    return res.status(404).type('text').send('Not found');
  });

  // Errors: multer / body-parser problems become 400s with plain-language messages;
  // anything else is logged and answered generically.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = 500;
    let message = MESSAGES.serverError;
    const declared = err?.status ?? err?.statusCode;

    if (err instanceof multer.MulterError) {
      status = 400;
      message = multerErrorMessage(err, uploadLimits);
    } else if (err?.code === 'UNSUPPORTED_FILE_TYPE') {
      status = 400;
      message = err.message || MESSAGES.fileType;
    } else if (err?.type === 'entity.too.large' || declared === 413) {
      status = 413;
      message = MESSAGES.tooLarge;
    } else if (Number.isInteger(declared) && declared >= 400 && declared < 500) {
      status = declared;
      message = MESSAGES.badRequest;
    } else {
      logger.error?.('[server] unhandled error:', err);
    }
    return sendFailure(req, res, status, message);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Mail transport
// ---------------------------------------------------------------------------

const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

/**
 * Verify the SMTP transport (with retries for transient boot-time failures) and,
 * once it answers, bind `book.sendMail` so the handler starts sending.
 * @returns {Promise<boolean>} whether the transport verified
 */
export async function connectMail({ transporter, book, logger = console, attempts = 5, delayMs = 30_000, onState = () => {} }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await transporter.verify();
      book.sendMail = (message) => transporter.sendMail(message);
      onState('ready');
      logger.info?.('[mail] SMTP ready');
      return true;
    } catch (err) {
      onState('failed');
      logger.warn?.(`[mail] SMTP verify failed (attempt ${attempt}/${attempts}): ${err?.message ?? err}`);
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  logger.warn?.('[mail] giving up on SMTP; POST /api/book answers 503 until the next restart');
  return false;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export async function start(env = process.env) {
  const logger = console;
  const port = Number.parseInt(env.PORT, 10) || 3000;
  const mailTo = (env.MAIL_TO || DEFAULT_MAIL_TO).trim();
  const mailFrom = (env.MAIL_FROM || env.SMTP_USER || mailTo).trim();
  const siteUrl = typeof env.SITE_URL === 'string' ? env.SITE_URL.trim().replace(/\/+$/, '') : undefined;
  const turnstileSecret = typeof env.TURNSTILE_SECRET === 'string' ? env.TURNSTILE_SECRET.trim() : '';
  const smtp = smtpOptionsFromEnv(env);

  const book = {
    sendMail: undefined,
    mailTo,
    mailFrom,
    siteUrl,
    verifyTurnstile: turnstileSecret ? createTurnstileVerifier({ secret: turnstileSecret }) : undefined,
    logger,
  };

  let mailState = smtp ? 'verifying' : 'unconfigured';
  const app = createApp({ distDir: DEFAULT_DIST_DIR, book, logger, mailStatus: () => mailState });

  if (!existsSync(DEFAULT_DIST_DIR)) {
    logger.warn(`[server] ${DEFAULT_DIST_DIR} not found; run \`npm run build\` first (only /api and /healthz will answer)`);
  }

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.once('error', reject);
  });
  logger.info(
    `[server] listening on http://localhost:${port} · mail ${mailState} · to ${mailTo}` +
      `${book.verifyTurnstile ? ' · turnstile on' : ''}${siteUrl ? ` · site ${siteUrl}` : ''}`,
  );

  if (smtp) {
    const transporter = nodemailer.createTransport(smtp);
    // Do not await: the site must serve while SMTP is being verified.
    connectMail({
      transporter,
      book,
      logger,
      onState: (state) => {
        mailState = state;
      },
    });
  } else {
    logger.warn('[server] SMTP_HOST not set; POST /api/book answers 503 until SMTP_* are configured');
  }

  const shutdown = (signal) => {
    logger.info(`[server] ${signal} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  return { app, server, book };
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  start().catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}
