// Applies db/schema.sql to DATABASE_URL. Safe to run repeatedly.
//   DATABASE_URL=postgres://... npm run db:migrate
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL first.');
  process.exit(1);
}
const sql = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(sql);
  console.log('Schema red_team is up to date.');
} finally {
  await client.end();
}
