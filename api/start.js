// POST /api/start  { email, firstName, lastName, phone }
// Called when an applicant finishes question 1.
//  - New email: creates their draft, signs this browser in, saves the answers.
//  - Email already has an application: emails a one-time link instead, so nobody can
//    open someone else's draft by typing their address.
import { query, tx } from './_lib/db.js';
import { route, HttpError } from './_lib/http.js';
import { checkAnswer, normalizeEmail } from './_lib/questions.js';
import { sessionApplication, startSession } from './_lib/session.js';
import { applicationState, saveAnswers, sendLoginLink } from './_lib/applications.js';

export default route({
  async POST(req, res, body) {
    // Bots fill the hidden field. Give them the normal-looking answer and store nothing.
    if (body.company_website) return { status: 'check_email' };

    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'invalid_email');
    const answers = {
      first_name: String(body.firstName ?? '').trim(),
      last_name: String(body.lastName ?? '').trim(),
      phone: String(body.phone ?? '').trim(),
    };
    if (!answers.first_name || !answers.last_name) throw new HttpError(400, 'name_required');
    for (const [k, v] of Object.entries(answers)) {
      const err = checkAnswer(k, v);
      if (err) throw new HttpError(400, 'invalid_answer', err);
    }

    // Already signed in to this application in this browser: just save.
    const current = await sessionApplication(req);
    if (current && current.email === email) {
      if (current.status === 'draft') await tx((db) => saveAnswers(current.id, answers, db));
      return { status: 'ok', application: await applicationState(current) };
    }

    const created = await tx(async (db) => {
      const { rows } = await db.query(
        `insert into red_team.applications (email) values ($1)
         on conflict (email) do nothing returning *`,
        [email],
      );
      if (!rows[0]) return null;
      await saveAnswers(rows[0].id, answers, db);
      await startSession(res, rows[0].id, db);
      return rows[0];
    });
    if (created) return { status: 'ok', application: await applicationState(created) };

    const { rows } = await query('select * from red_team.applications where email = $1', [email]);
    await sendLoginLink(rows[0]);
    return { status: 'check_email' };
  },
});
