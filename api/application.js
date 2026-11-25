// GET   /api/application            -> the signed-in applicant's application
// PATCH /api/application { answers } -> autosave answers (drafts only)
import { tx } from '../lib/db.js';
import { route, HttpError } from '../lib/http.js';
import { checkAnswer } from '../lib/questions.js';
import { requireApplication, requireDraft } from '../lib/session.js';
import { applicationState, saveAnswers } from '../lib/applications.js';

export default route({
  async GET(req) {
    const app = await requireApplication(req);
    return { application: await applicationState(app) };
  },

  async PATCH(req, res, body) {
    const app = await requireApplication(req);
    requireDraft(app);
    const answers = body.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'answers_required');
    const entries = Object.entries(answers);
    if (entries.length > 20) throw new HttpError(400, 'too_many_answers');
    for (const [k, v] of entries) {
      const err = checkAnswer(k, v);
      if (err) throw new HttpError(400, 'invalid_answer', err);
    }
    await tx((db) => saveAnswers(app.id, answers, db));
    return { ok: true };
  },
});
