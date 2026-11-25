import { query } from './db.js';

// Everything the form needs to restore an application.
export async function applicationState(app, db = { query }) {
  const [answers, resume] = await Promise.all([
    db.query('select question_key, answer_text from red_team.answers where application_id = $1', [app.id]),
    db.query(
      `select file_name, content_type, size_bytes from red_team.documents
        where application_id = $1 and kind = 'resume'`,
      [app.id],
    ),
  ]);
  const r = resume.rows[0];
  return {
    email: app.email,
    status: app.status,
    submittedAt: app.submitted_at,
    answers: Object.fromEntries(answers.rows.map((x) => [x.question_key, x.answer_text])),
    resume: r ? { fileName: r.file_name, contentType: r.content_type, sizeBytes: Number(r.size_bytes) } : null,
  };
}

export async function saveAnswers(applicationId, answers, db) {
  for (const [key, value] of Object.entries(answers)) {
    await db.query(
      `insert into red_team.answers (application_id, question_key, answer_text)
       values ($1, $2, $3)
       on conflict (application_id, question_key)
       do update set answer_text = excluded.answer_text, updated_at = now()
       where red_team.answers.answer_text is distinct from excluded.answer_text`,
      [applicationId, key, value],
    );
  }
  await db.query('update red_team.applications set updated_at = now() where id = $1', [applicationId]);
}
