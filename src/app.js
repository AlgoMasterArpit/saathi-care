import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { HttpError } from './lib/errors.js';
import { silentLogger } from './lib/logger.js';
import { createApiRouter } from './routes/api.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const INDEX_FILE = fileURLToPath(new URL('../public/index.html', import.meta.url));

const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
});

function requestLogger(logger) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        httpRequest: {
          requestMethod: req.method,
          requestUrl: req.baseUrl + req.path,
          status: res.statusCode,
          latency: `${Number(process.hrtime.bigint() - started) / 1e9}s`,
        },
      });
    });
    next();
  };
}

export function createApp({ logger = silentLogger, ...deps }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=()');
    next();
  });
  app.use(compression());

  const jsonBody = express.json({ limit: '100kb' });
  app.use('/api', requestLogger(logger), (req, res, next) => (req.path === '/ai/scan' ? next() : jsonBody(req, res, next)));
  app.use('/api', createApiRouter({ logger, ...deps }));

  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        res.set('Cache-Control', /\.(svg|webmanifest|txt)$/.test(filePath) ? 'public, max-age=86400' : 'no-cache');
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(INDEX_FILE);
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, ...(error.details ? { details: error.details } : {}) });
    }
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON' });
    logger.error('unhandled error', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
