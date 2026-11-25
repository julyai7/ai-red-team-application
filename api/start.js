// POST /api/start  { email, firstName, lastName, phone }
// Called when an applicant finishes question 1.
//  - New email: creates their draft, signs this browser in, saves the answers.
//  - Same browser coming back: its session cookie reopens the draft.
//  - Email already has an application (from another browser): refused with 409, so
//    nobody can open or overwrite someone else's application by typing their address.
import { tx } from './_lib/db.js';
import { route, HttpError } from './_lib/http.js';
import { checkAnswer, normalizeEmail } from './_lib/questions.js';
import { sessionApplication, startSession } from './_lib/session.js';
import { applicationState, saveAnswers } from './_lib/applications.js';

export default route({
  async POST(req, res, body) {
    // Bots fill the hidden field. Give them the normal-looking answer and store nothing.
    if (body.company_website) throw new HttpError(409, 'already_applied');

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

    throw new HttpError(409, 'already_applied', 'An application with this email already exists.');
  },
});
