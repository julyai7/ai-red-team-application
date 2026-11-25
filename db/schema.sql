-- Red Team contributor applications.
--
-- Everything lives in its own schema, `red_team`, so it sits next to the July app's
-- tables in the same database without touching them (Rails only manages `public`).
-- Safe to run more than once. Run it in Postico's SQL window, or with
-- `npm run db:migrate` (uses DATABASE_URL).
--
-- No extensions needed: gen_random_uuid() is built into Postgres 13+.

create schema if not exists red_team;

-- One row per applicant. The unique email is what limits people to one application.
create table if not exists red_team.applications (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and email like '%_@_%'),
  status        text not null default 'draft' check (status in ('draft', 'submitted')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  constraint applications_submitted_at_matches_status
    check ((status = 'submitted') = (submitted_at is not null))
);
create unique index if not exists applications_email_key on red_team.applications (email);
create index if not exists applications_status_idx on red_team.applications (status, updated_at desc);

-- One row per answered question. Autosave upserts on (application_id, question_key).
create table if not exists red_team.answers (
  application_id  uuid not null references red_team.applications (id) on delete cascade,
  question_key    text not null,
  answer_text     text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (application_id, question_key)
);

-- Files stored in S3 (resumes now; transcripts and other documents later).
create table if not exists red_team.documents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references red_team.applications (id) on delete cascade,
  kind            text not null check (kind in ('resume', 'transcript', 'other')),
  s3_bucket       text not null,
  s3_key          text not null unique,
  file_name       text not null,
  content_type    text not null,
  size_bytes      bigint not null check (size_bytes > 0),
  created_at      timestamptz not null default now()
);
-- An application has at most one current resume; uploading a new one replaces it.
create unique index if not exists documents_one_resume_per_application
  on red_team.documents (application_id) where kind = 'resume';

-- Removed: emailed one-time links are no longer used.
drop table if exists red_team.login_tokens;

-- Browser sessions (an HttpOnly cookie holds the token; only its hash is stored).
create table if not exists red_team.sessions (
  token_hash      text primary key,
  application_id  uuid not null references red_team.applications (id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index if not exists sessions_application_idx on red_team.sessions (application_id);

-- Renamed question keys (ack_application_process, ack_sample_steps -> clearer names).
update red_team.answers set question_key = 'agreed_samples_required' where question_key = 'ack_application_process';
update red_team.answers set question_key = 'read_sample_steps' where question_key = 'ack_sample_steps';

-- One row per application with the answers as columns. Easiest table to browse in Postico.
-- Dropped and recreated so column changes apply (create or replace can't rename columns).
drop view if exists red_team.application_overview;
create view red_team.application_overview as
select
  a.id,
  a.email,
  a.status,
  max(ans.answer_text) filter (where ans.question_key = 'first_name')              as first_name,
  max(ans.answer_text) filter (where ans.question_key = 'last_name')               as last_name,
  max(ans.answer_text) filter (where ans.question_key = 'phone')                   as phone,
  max(ans.answer_text) filter (where ans.question_key = 'source')                  as source,
  max(ans.answer_text) filter (where ans.question_key = 'work_auth')               as work_auth,
  max(ans.answer_text) filter (where ans.question_key = 'work_auth_other')         as work_auth_other,
  max(ans.answer_text) filter (where ans.question_key = 'agreed_samples_required') as agreed_samples_required,
  max(ans.answer_text) filter (where ans.question_key = 'read_sample_steps')        as read_sample_steps,
  d.file_name     as resume_file_name,
  d.s3_bucket     as resume_s3_bucket,
  d.s3_key        as resume_s3_key,
  a.created_at,
  a.updated_at,
  a.submitted_at
from red_team.applications a
left join red_team.answers ans on ans.application_id = a.id
left join red_team.documents d on d.application_id = a.id and d.kind = 'resume'
group by a.id, d.file_name, d.s3_bucket, d.s3_key;
