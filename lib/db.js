import pg from 'pg';

let pool = null;
let override = null; // tests swap in an in-memory Postgres

export function isConfigured() {
  return Boolean(override || process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Heroku Postgres requires TLS with its own certificate.
      ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
      // Serverless functions run many small instances; keep each one's footprint tiny.
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export function query(text, params) {
  return (override || getPool()).query(text, params);
}

// Runs fn(db) inside a transaction; db.query has the same shape as query().
export async function tx(fn) {
  if (override) return override.transaction((t) => fn({ query: (q, p) => t.query(q, p) }));
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function useTestDb(db) {
  override = db;
}
