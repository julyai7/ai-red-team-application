import { query } from './db.js';
import { sendEmail, loginEmail } from './email.js';
import { siteUrl } from './http.js';
import { hashToken, newToken } from './session.js';

const LINK_MINUTES = 30;

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

// Emails a one-time link that reopens the application. Quietly skips if one was
// sent in the last minute or five in the last hour, so the form can't be used to spam.
export async function sendLoginLink(app) {
  const { rows } = await query(
    `select count(*)::int as hour,
            count(*) filter (where created_at > now() - interval '1 minute')::int as minute
       from red_team.login_tokens
      where application_id = $1 and created_at > now() - interval '1 hour'`,
    [app.id],
  );
  if (rows[0].minute > 0 || rows[0].hour >= 5) return false;

  const token = newToken();
  await query(
    `insert into red_team.login_tokens (token_hash, application_id, expires_at)
     values ($1, $2, now() + make_interval(mins => $3))`,
    [hashToken(token), app.id, LINK_MINUTES],
  );
  const link = `${siteUrl()}/?resume=${encodeURIComponent(token)}#application`;
  await sendEmail({ to: app.email, ...loginEmail(link, app.status === 'submitted') });
  return true;
}
