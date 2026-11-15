import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { seedDemo } from './demo.js';
import { createLogger } from './lib/logger.js';
import { createReminderRunner } from './scheduler.js';
import { createGemini } from './services/gemini.js';
import { createMailer } from './services/mailer.js';
import { createFirestoreStore } from './store/firestore.js';
import { createMemoryStore } from './store/memory.js';

const config = loadConfig();
const logger = createLogger();

const store = config.firestore.credentials || config.firestore.projectId ? createFirestoreStore(config.firestore) : createMemoryStore();
const mailer = createMailer({ ...config.gmail, appUrl: config.publicUrl, logger });
const ai = createGemini({ ...config.gemini, logger });
const runner = createReminderRunner({ store, mailer, logger });

if (config.seedDemo) await seedDemo(store);

const app = createApp({ store, ai, mailer, config, runner, logger });
const server = app.listen(config.port, () => {
  logger.info('saathi started', { port: config.port, store: store.kind, ai: ai.enabled, email: mailer.enabled });
});
const stopScheduler = runner.start(config.tickIntervalMs);

function shutdown(signal) {
  logger.info('shutting down', { signal });
  stopScheduler();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
