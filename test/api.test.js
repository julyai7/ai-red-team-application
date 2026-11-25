// End-to-end tests of the API handlers against a real (in-memory) Postgres.
//   npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { useTestDb } from '../lib/db.js';
import { useFakeS3 } from '../lib/s3.js';
import { useFakeEmail } from '../lib/email.js';

import start from '../api/start.js';
import application from '../api/application.js';
import submit from '../api/submit.js';
import uploadUrl from '../api/resume/upload-url.js';
import complete from '../api/resume/complete.js';
import link from '../api/auth/link.js';
import verify from '../api/auth/verify.js';
import logout from '../api/auth/logout.js';

process.env.APP_URL = 'https://apply.example.com';

let pg;
const sent = [];
const objects = new Map();

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  // Run it twice to prove it's safe to re-run.
  await pg.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  useTestDb(pg);
  useFakeEmail(async (m) => { sent.push(m); });
  useFakeS3({
    presignUpload: async (key) => `https://s3.example.com/${key}?signed`,
    objectSize: async (key) => objects.get(key) ?? null,
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

async function uploadResume(call, size = 2048) {
  const u = await call(uploadUrl, 'POST', { fileName: 'cv.pdf', size });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  objects.set(u.body.key, size);
  return call(complete, 'POST', { key: u.body.key, fileName: 'cv.pdf' });
}

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

test('one application per email; returning applicant gets a magic link', async () => {
  const first = browser();
  await first(start, 'POST', contact('grace@example.com'));
  await first(application, 'PATCH', { answers: { source: 'LinkedIn' } });

  // Same person on another device: no access to the draft, an email instead.
  const other = browser();
  sent.length = 0;
  const s = await other(start, 'POST', { ...contact('GRACE@example.com'), firstName: 'Mallory' });
  assert.equal(s.body.status, 'check_email');
  assert.equal(s.headers['set-cookie'], undefined);
  assert.equal((await other(application, 'GET')).status, 401);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'grace@example.com');

  // The typed-in name did not overwrite the real draft.
  const { rows } = await pg.query(`select count(*)::int as n from red_team.applications where email = 'grace@example.com'`);
  assert.equal(rows[0].n, 1);

  const token = new URL(/https:\/\/\S+/.exec(sent[0].text)[0]).searchParams.get('resume');
  const v = await other(verify, 'POST', { token });
  assert.equal(v.status, 200);
  assert.equal(v.body.application.answers.first_name, 'Ada');
  assert.equal(v.body.application.answers.source, 'LinkedIn');
  assert.equal((await other(application, 'GET')).status, 200);

  // Links work once.
  assert.equal((await browser()(verify, 'POST', { token })).status, 400);
});

test('magic links are rate limited and do not reveal who applied', async () => {
  const call = browser();
  sent.length = 0;
  const unknown = await call(link, 'POST', { email: 'nobody@example.com' });
  assert.equal(unknown.body.status, 'check_email');
  assert.equal(sent.length, 0);

  await browser()(start, 'POST', contact('linus@example.com'));
  await call(link, 'POST', { email: 'linus@example.com' });
  await call(link, 'POST', { email: 'linus@example.com' }); // within a minute: skipped
  assert.equal(sent.length, 1);
});

test('expired links are rejected', async () => {
  const call = browser();
  sent.length = 0;
  await browser()(start, 'POST', contact('old@example.com'));
  await call(link, 'POST', { email: 'old@example.com' });
  const token = new URL(/https:\/\/\S+/.exec(sent[0].text)[0]).searchParams.get('resume');
  await pg.query(`update red_team.login_tokens set expires_at = now() - interval '1 second'`);
  assert.equal((await call(verify, 'POST', { token })).status, 400);
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
  assert.equal(bot.body.status, 'check_email');
  const { rows } = await pg.query(`select count(*)::int as n from red_team.applications where email = 'bot@example.com'`);
  assert.equal(rows[0].n, 0);

  await call(start, 'POST', contact('val@example.com'));
  assert.equal((await call(application, 'PATCH', { answers: { source: 'Myspace' } })).status, 400);
  assert.equal((await call(application, 'PATCH', { answers: { is_admin: 'true' } })).status, 400);
  assert.equal((await call(uploadUrl, 'POST', { fileName: 'cv.exe', size: 10 })).status, 400);
  assert.equal((await call(uploadUrl, 'POST', { fileName: 'cv.pdf', size: 11 * 1024 * 1024 })).status, 400);
  // Can't claim a file that belongs to someone else's application.
  assert.equal((await call(complete, 'POST', { key: 'red-team-applications/00000000-0000-0000-0000-000000000000/resume/00000000-0000-0000-0000-000000000000.pdf' })).status, 400);
  // Signed URL issued but the file never arrived.
  const u = await call(uploadUrl, 'POST', { fileName: 'cv.pdf', size: 100 });
  assert.equal((await call(complete, 'POST', { key: u.body.key, fileName: 'cv.pdf' })).status, 400);
  // File bigger than allowed after upload is deleted.
  objects.set(u.body.key, 20 * 1024 * 1024);
  assert.equal((await call(complete, 'POST', { key: u.body.key, fileName: 'cv.pdf' })).status, 400);
  assert.equal(objects.has(u.body.key), false);
});

test('uploading a new resume replaces the old one', async () => {
  const call = browser();
  await call(start, 'POST', contact('re@example.com'));
  const a = await call(uploadUrl, 'POST', { fileName: 'a.pdf', size: 10 });
  objects.set(a.body.key, 10);
  await call(complete, 'POST', { key: a.body.key, fileName: 'a.pdf' });
  const b = await call(uploadUrl, 'POST', { fileName: 'b.docx', size: 20 });
  objects.set(b.body.key, 20);
  await call(complete, 'POST', { key: b.body.key, fileName: 'b.docx' });
  const g = await call(application, 'GET');
  assert.equal(g.body.application.resume.fileName, 'b.docx');
  assert.equal(objects.has(a.body.key), false);
  const { rows } = await pg.query(`select count(*)::int as n from red_team.documents d join red_team.applications a on a.id = d.application_id where a.email = 're@example.com'`);
  assert.equal(rows[0].n, 1);
});
