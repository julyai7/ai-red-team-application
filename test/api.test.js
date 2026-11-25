// End-to-end tests of the API handlers against a real (in-memory) Postgres.
//   npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { useTestDb } from '../api/_lib/db.js';
import { useFakeS3 } from '../api/_lib/s3.js';

import start from '../api/start.js';
import application from '../api/application.js';
import submit from '../api/submit.js';
import resume from '../api/resume.js';
import logout from '../api/auth/logout.js';

process.env.APP_URL = 'https://apply.example.com';

let pg;
const objects = new Map();

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  // Run it twice to prove it's safe to re-run.
  await pg.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  useTestDb(pg);
  useFakeS3({
    putObject: async (key, body) => { objects.set(key, body.length); },
    deleteObject: async (key) => { objects.delete(key); },
  });
});

// A tiny browser: keeps the session cookie between calls.
function browser() {
  let cookie = '';
  return async function call(handler, method, body, extraHeaders = {}) {
    const req = { method, headers: { host: 'apply.example.com', origin: 'https://apply.example.com', cookie, ...extraHeaders }, body };
    const headers = {};
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const res = {
      statusCode: 200, writableEnded: false,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      end(data) { this.writableEnded = true; resolve(data); },
    };
    await handler(req, res);
    const data = await done;
    const sc = headers['set-cookie'];
    if (sc) cookie = /Max-Age=0/.test(sc) ? '' : sc.split(';')[0];
    return { status: res.statusCode, body: JSON.parse(data), headers };
  };
}

const contact = (email) => ({ email, firstName: 'Ada', lastName: 'Lovelace', phone: '+1 555 0100' });

const sendFile = (call, name, size) =>
  call(resume, 'POST', Buffer.alloc(size, 1), { 'x-file-name': encodeURIComponent(name), 'content-length': String(size) });
const uploadResume = (call, size = 2048) => sendFile(call, 'cv.pdf', size);

test('full happy path: draft, autosave, resume, submit', async () => {
  const call = browser();
  const s = await call(start, 'POST', contact('Ada@Example.com'));
  assert.equal(s.status, 200);
  assert.equal(s.body.status, 'ok');
  assert.equal(s.body.application.email, 'ada@example.com');
  assert.equal(s.body.application.status, 'draft');
  assert.equal(s.body.application.answers.first_name, 'Ada');
  assert.match(s.headers['set-cookie'], /HttpOnly/);
  assert.match(s.headers['set-cookie'], /Secure/);

  const p = await call(application, 'PATCH', { answers: { source: 'Reddit', work_auth: 'Other', work_auth_other: 'H-1B' } });
  assert.equal(p.status, 200);

  // Not complete yet.
  const early = await call(submit, 'POST', {});
  assert.equal(early.status, 422);
  assert.match(early.body.message, /resume/);

  const r = await uploadResume(call);
  assert.equal(r.status, 200);
  assert.equal(r.body.resume.fileName, 'cv.pdf');

  await call(application, 'PATCH', { answers: { ack_application_process: 'true', ack_sample_steps: 'true' } });
  const done = await call(submit, 'POST', {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.application.status, 'submitted');

  // Submitted applications can't be edited, and submitting again is harmless.
  assert.equal((await call(application, 'PATCH', { answers: { source: 'Discord' } })).status, 409);
  assert.equal((await call(submit, 'POST', {})).status, 200);

  const { rows } = await pg.query(`select * from red_team.application_overview where email = 'ada@example.com'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].work_auth_other, 'H-1B');
  assert.equal(rows[0].resume_file_name, 'cv.pdf');
  assert.equal(rows[0].status, 'submitted');
});

test('one application per email; same browser picks up where it left off', async () => {
  const first = browser();
  await first(start, 'POST', contact('grace@example.com'));
  await first(application, 'PATCH', { answers: { source: 'LinkedIn' } });

  // Same browser: the session reopens the draft, and question 1 can be saved again.
  const again = await first(start, 'POST', contact('Grace@example.com'));
  assert.equal(again.status, 200);
  assert.equal(again.body.application.answers.source, 'LinkedIn');
  assert.equal((await first(application, 'GET')).body.application.answers.source, 'LinkedIn');

  // Another browser with the same email: refused, nothing shown or overwritten.
  const other = browser();
  const s = await other(start, 'POST', { ...contact('GRACE@example.com'), firstName: 'Mallory' });
  assert.equal(s.status, 409);
  assert.equal(s.body.error, 'already_applied');
  assert.equal(s.body.application, undefined);
  assert.equal(s.headers['set-cookie'], undefined);
  assert.equal((await other(application, 'GET')).status, 401);
  const { rows } = await pg.query(`select o.first_name, (select count(*)::int from red_team.applications where email = 'grace@example.com') as n
                                     from red_team.application_overview o where o.email = 'grace@example.com'`);
  assert.equal(rows[0].n, 1);
  assert.equal(rows[0].first_name, 'Ada');
});

test('logout ends the session', async () => {
  const call = browser();
  await call(start, 'POST', contact('ken@example.com'));
  assert.equal((await call(application, 'GET')).status, 200);
  await call(logout, 'POST', {});
  assert.equal((await call(application, 'GET')).status, 401);
});

test('rejects bad input, other sites, and bots', async () => {
  const call = browser();
  assert.equal((await call(start, 'POST', { email: 'not-an-email', firstName: 'a', lastName: 'b' })).status, 400);
  assert.equal((await call(start, 'POST', { email: 'x@example.com', firstName: '', lastName: 'b' })).status, 400);
  assert.equal((await call(start, 'POST', contact('evil@example.com'), { origin: 'https://evil.example' })).status, 403);

  const bot = await call(start, 'POST', { ...contact('bot@example.com'), company_website: 'spam' });
  assert.equal(bot.status, 409);
  const { rows } = await pg.query(`select count(*)::int as n from red_team.applications where email = 'bot@example.com'`);
  assert.equal(rows[0].n, 0);

  await call(start, 'POST', contact('val@example.com'));
  assert.equal((await call(application, 'PATCH', { answers: { source: 'Myspace' } })).status, 400);
  assert.equal((await call(application, 'PATCH', { answers: { is_admin: 'true' } })).status, 400);
  assert.equal((await sendFile(call, 'cv.exe', 10)).status, 400);
  assert.equal((await sendFile(call, 'cv.pdf', 5 * 1024 * 1024)).status, 413);
  assert.equal((await sendFile(call, 'cv.pdf', 0)).status, 400);
  // Signed-out browsers can't upload.
  assert.equal((await sendFile(browser(), 'cv.pdf', 10)).status, 401);
});

test('uploading a new resume replaces the old one', async () => {
  const call = browser();
  await call(start, 'POST', contact('re@example.com'));
  await sendFile(call, 'a.pdf', 10);
  const firstKey = [...objects.keys()].pop();
  await sendFile(call, 'b.docx', 20);
  const g = await call(application, 'GET');
  assert.equal(g.body.application.resume.fileName, 'b.docx');
  assert.equal(objects.has(firstKey), false);
  const { rows } = await pg.query(`select count(*)::int as n from red_team.documents d join red_team.applications a on a.id = d.application_id where a.email = 're@example.com'`);
  assert.equal(rows[0].n, 1);
});
