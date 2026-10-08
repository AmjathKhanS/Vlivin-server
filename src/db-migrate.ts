import { loadConfig } from './config.js';
import { connectPg, migrate } from './store/postgres.js';

const { DATABASE_URL } = loadConfig();
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = await connectPg(DATABASE_URL);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
await db.close?.();
