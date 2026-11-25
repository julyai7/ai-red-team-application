// POST /api/auth/verify { token } -> exchanges an emailed link for a session.
// The link opens the page, and the page posts the token here. Email scanners that
// merely fetch the link don't run the page's script, so they can't use it up.
import { tx } from '../../lib/db.js';
import { route, HttpError } from '../../lib/http.js';
import { hashToken, startSession } from '../../lib/session.js';
import { applicationState } from '../../lib/applications.js';

export default route({
  async POST(req, res, body) {
    const token = String(body.token || '');
    if (!token || token.length > 100) throw new HttpError(400, 'link_invalid');
    const app = await tx(async (db) => {
      const { rows } = await db.query(
        `update red_team.login_tokens set used_at = now()
          where token_hash = $1 and used_at is null and expires_at > now()
          returning application_id`,
        [hashToken(token)],
      );
      if (!rows[0]) return null;
      await startSession(res, rows[0].application_id, db);
      const a = await db.query('select * from red_team.applications where id = $1', [rows[0].application_id]);
      return a.rows[0];
    });
    if (!app) throw new HttpError(400, 'link_invalid', 'This link has expired or was already used.');
    return { application: await applicationState(app) };
  },
});
