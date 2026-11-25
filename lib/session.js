import { createHash, randomBytes } from 'node:crypto';
import { query } from './db.js';
import { cookies, HttpError, siteUrl } from './http.js';

const COOKIE = 'rt_session';
const SESSION_DAYS = 30;

export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

function cookieFlags() {
  return siteUrl().startsWith('https://') ? '; Secure' : '';
}

export async function startSession(res, applicationId, db = { query }) {
  const token = newToken();
  await db.query(
    `insert into red_team.sessions (token_hash, application_id, expires_at)
     values ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), applicationId, SESSION_DAYS],
  );
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${cookieFlags()}`);
}

export function endSession(req, res) {
  const token = cookies(req)[COOKIE];
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieFlags()}`);
  if (token) return query('delete from red_team.sessions where token_hash = $1', [hashToken(token)]);
}

// The application tied to this browser's session cookie, or null.
export async function sessionApplication(req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await query(
    `select a.* from red_team.sessions s
       join red_team.applications a on a.id = s.application_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

export async function requireApplication(req) {
  const app = await sessionApplication(req);
  if (!app) throw new HttpError(401, 'no_session');
  return app;
}

export function requireDraft(app) {
  if (app.status !== 'draft') throw new HttpError(409, 'already_submitted');
}
