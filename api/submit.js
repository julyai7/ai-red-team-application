// POST /api/submit -> marks the draft as submitted once every required answer and the resume are in.
import { tx } from '../lib/db.js';
import { route, HttpError } from '../lib/http.js';
import { missingForSubmit } from '../lib/questions.js';
import { requireApplication } from '../lib/session.js';
import { applicationState } from '../lib/applications.js';

export default route({
  async POST(req) {
    const app = await requireApplication(req);
    const updated = await tx(async (db) => {
      const { rows } = await db.query('select * from red_team.applications where id = $1 for update', [app.id]);
      const current = rows[0];
      if (current.status === 'submitted') return current; // already done; submitting twice is harmless
      const state = await applicationState(current, db);
      const missing = missingForSubmit(state.answers, Boolean(state.resume));
      if (missing.length) throw new HttpError(422, 'incomplete', 'Missing: ' + missing.join(', '));
      const res = await db.query(
        `update red_team.applications
            set status = 'submitted', submitted_at = now(), updated_at = now()
          where id = $1 returning *`,
        [app.id],
      );
      return res.rows[0];
    });
    return { application: await applicationState(updated) };
  },
});
