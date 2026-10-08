import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectPg, migrate, PostgresStore } from './store/postgres.js';

const config = loadConfig();

// With DATABASE_URL we use Postgres (migrating on boot); otherwise fall back to the in-memory store.
const db = config.DATABASE_URL ? await connectPg(config.DATABASE_URL) : null;
if (db) await migrate(db);
const { app } = await buildApp({ config, ...(db ? { store: new PostgresStore(db) } : {}) });
if (!db) app.log.warn('DATABASE_URL not set: using the in-memory store. Data is lost on restart.');

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await db?.close?.();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
