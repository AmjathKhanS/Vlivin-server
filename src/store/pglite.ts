import { PGlite } from '@electric-sql/pglite';
import type { Db } from './postgres.js';

/** In-process real Postgres (WASM) for tests and local development without a server. */
export async function createPglite(): Promise<Db> {
  const pg = new PGlite();
  await pg.waitReady;
  return {
    async query(sql, params) {
      // PGlite takes one statement with params; multi-statement scripts go through exec().
      if (!params || params.length === 0) {
        const res = await pg.exec(sql);
        return (res[res.length - 1]?.rows ?? []) as any;
      }
      return (await pg.query(sql, params as any[])).rows as any;
    },
    async transaction(fn) {
      return pg.transaction((tx) => fn({
        query: async (sql, params) => {
          if (!params || params.length === 0) {
            const res = await tx.exec(sql);
            return (res[res.length - 1]?.rows ?? []) as any;
          }
          return (await tx.query(sql, params as any[])).rows as any;
        },
      }));
    },
    close: () => pg.close(),
  };
}
