// POST /api/auth/link { email } -> emails a link to reopen the application, if one exists.
// Always answers the same way so it can't be used to check who has applied.
import { query } from '../../lib/db.js';
import { route, HttpError } from '../../lib/http.js';
import { normalizeEmail } from '../../lib/questions.js';
import { sendLoginLink } from '../../lib/applications.js';

export default route({
  async POST(req, res, body) {
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'invalid_email');
    const { rows } = await query('select * from red_team.applications where email = $1', [email]);
    if (rows[0]) await sendLoginLink(rows[0]);
    return { status: 'check_email' };
  },
});
