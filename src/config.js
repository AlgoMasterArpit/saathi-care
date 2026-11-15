import { randomBytes } from 'node:crypto';

function parseCredentials(raw) {
  if (!raw) return null;
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(json);
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET || (production ? '' : randomBytes(32).toString('hex'));
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');

  return {
    port: Number(env.PORT) || 8080,
    production,
    sessionSecret,
    sessionTtlMs: 12 * 60 * 60 * 1000,
    publicUrl: env.PUBLIC_URL || '',
    cronSecret: env.CRON_SECRET || '',
    tickIntervalMs: Number(env.REMINDER_INTERVAL_MS) || 60_000,
    seedDemo: env.SEED_DEMO !== 'false',
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || 'gemini-3.5-flash',
      fallbackModel: env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite',
    },
    gmail: { user: env.GMAIL_USER || '', pass: (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    firestore: { credentials: parseCredentials(env.FIRESTORE_CREDENTIALS), projectId: env.GOOGLE_CLOUD_PROJECT || undefined },
  };
}
