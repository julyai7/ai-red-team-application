# AI Red Team Application

Application flow for July AI's AI Red Teaming contributor role, styled to match
[gojuly.ai](https://www.gojuly.ai/). Hosted on Vercel (team `july-ai`) at
https://ai-red-team-application.vercel.app.

- **`index.html`**: a plain job post laid out like an Ashby listing: title,
  details sidebar, and **Overview / Application** tabs. The Application tab
  (`index.html#application`) holds the form, one question per step, with the
  questions from the [original Typeform](https://form.typeform.com/to/sxEbJwG6).
- **`apply.js`**: the form. Autosaves every answer to the API as people type.
- **`api/`**: Vercel serverless functions (Node). They store applications in
  Postgres and resumes in S3, and email one-time links through SendGrid.
- **`db/schema.sql`**: the tables, in their own `red_team` schema.
- **`apply.html`**: redirects old links to `index.html#application`.

## How it works

1. **Question 1** (name and email) creates a **draft** application and signs the
   browser in with an HttpOnly session cookie. From then on every answer is
   **autosaved** (the progress bar shows "Saved").
2. The **resume** (PDF, DOC or DOCX, up to 4 MB) is sent to `/api/resume`, which
   stores it in S3. The 4 MB cap comes from Vercel's 4.5 MB request limit.
3. **One application per person**: emails are unique. If someone enters an email
   that already has an application, nothing is shown or overwritten. Instead we email
   them a one-time link (expires in 30 minutes) that reopens their draft on any device.
   "Continue your application" on the first screen does the same.
4. The last step marks the application **submitted** and opens the July app for the
   three sample challenges.

## Database (`red_team` schema)

| Table | What's in it |
|---|---|
| `applications` | One row per applicant: `email` (unique), `status` (`draft` / `submitted`), `created_at`, `updated_at`, `submitted_at` |
| `answers` | One row per answer: `application_id`, `question_key`, `answer_text`, `created_at`, `updated_at` |
| `documents` | Files in S3: `kind` (`resume`, `transcript`, `other`), `s3_bucket`, `s3_key`, `file_name`, `content_type`, `size_bytes` |
| `login_tokens`, `sessions` | Emailed links and browser sessions (hashed tokens only) |
| `application_overview` (view) | One row per application with every answer as a column. The easiest thing to browse in Postico. |

Question keys: `first_name`, `last_name`, `phone`, `source`, `work_auth`,
`work_auth_other`, `ack_application_process`, `ack_sample_steps`. The allowed
values live in `api/_lib/questions.js`; keep them in sync with `index.html`.

The schema lives beside the July app's tables in the same database but in its own
schema, so Rails migrations and `db/schema.rb` don't see it.

## Setup

### 1. Database

Create the tables by running `db/schema.sql`, either in Postico's SQL window or with:

```bash
DATABASE_URL='postgres://…' npm run db:migrate
```

It's safe to run again. Ideally give the app its own Postgres role that can
only touch this schema (on Heroku: `heroku pg:credentials:create --name red_team_app`), then:

```sql
grant usage on schema red_team to red_team_app;
grant select, insert, update, delete on all tables in schema red_team to red_team_app;
```

Heroku can rotate database credentials during maintenance. If that happens,
update `DATABASE_URL` in Vercel.

### 2. S3

Use a bucket in `us-east-2` (or set `S3_REGION`). Files go under
`red-team-applications/<application id>/`. The access key needs:

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::BUCKET/red-team-applications/*"
}
```

Uploads go through the API, so the bucket needs no CORS rule. It currently uses the
July app's bucket (`julyai-prod`) and key.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Example |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `S3_BUCKET` | `july-uploads` |
| `S3_REGION` | `us-east-2` (default) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | key limited to the policy above |
| `SENDGRID_API_KEY` | the July app's SendGrid key works |
| `EMAIL_FROM` | `July AI <eun@gojuly.ai>` (must be a verified SendGrid sender) |
| `APP_URL` | `https://ai-red-team-application.vercel.app` (base for emailed links) |

Then redeploy: `vercel deploy --prod --scope july-ai`.

Until `DATABASE_URL` is set, the API answers `503 not_configured` and the form
falls back to **preview mode** (yellow notice, answers kept only in the browser).
Opening `index.html` straight from disk also uses preview mode.

## Development

```bash
npm install
npm test          # API tests against an in-memory Postgres (PGlite)
vercel dev        # site + API at http://localhost:3000 (needs the env vars above)
```

## Notes

- Nothing marks the three samples complete automatically yet: that needs the
  main July app to report sample-module progress. Until then, check completion in
  the `#sample_submission_activities` Slack channel.
- The sample button opens `app.gojuly.ai/?invite_code=PGHFQGWA`, which unlocks the
  Red Team Sample Submission module.
- A hidden honeypot field drops simple bots. Emailed links are rate limited
  (one a minute, five an hour per application).
- Styles are copied from `julyai7/julyai7.github.io`
  (`web/tailwind.config.js`, `web/src/index.css`). `media/marble.jpg` and
  `favicon.svg` come from that repo too.
