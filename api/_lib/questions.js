// The application's questions as stored in red_team.answers.question_key.
// Keep the option lists in sync with index.html and apply.js.

export const SOURCES = [
  'Referral', '80,000 Hours', 'Reddit', 'LinkedIn', 'Discord', 'ilovecreatives',
  'Web Forum', 'Make Writing Your Job', 'Substack', 'Fiverr', 'FreeUp', 'Freelancer',
  'Other Newsletter', 'ProBlogger', 'Flexjobs', 'Other',
];
export const WORK_AUTH = ['Yes, I am a U.S. citizen', 'Yes, I am a permanent resident', 'Other'];

const BOOL = ['true', 'false'];

// key -> { max length, allowed values (if fixed) }
export const QUESTIONS = {
  first_name: { max: 100 },
  last_name: { max: 100 },
  phone: { max: 40 },
  source: { options: SOURCES },
  work_auth: { options: WORK_AUTH },
  work_auth_other: { max: 500 },
  ack_application_process: { options: BOOL },
  ack_sample_steps: { options: BOOL },
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const RESUME_EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// Uploads pass through a Vercel function, which caps request bodies at 4.5 MB.
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
}

// Checks one autosaved answer. Empty strings are allowed (a cleared field);
// completeness is only enforced on submit.
export function checkAnswer(key, value) {
  const q = QUESTIONS[key];
  if (!q) return 'Unknown question: ' + key;
  if (typeof value !== 'string') return 'Answer must be text: ' + key;
  if (value === '') return null;
  if (q.options && !q.options.includes(value)) return 'Invalid choice for ' + key;
  if (q.max && value.length > q.max) return 'Answer too long: ' + key;
  return null;
}

// What's still missing before an application can be submitted.
export function missingForSubmit(answers, hasResume) {
  const missing = [];
  for (const k of ['first_name', 'last_name', 'source', 'work_auth']) if (!answers[k]?.trim()) missing.push(k);
  if (answers.work_auth === 'Other' && !answers.work_auth_other?.trim()) missing.push('work_auth_other');
  if (answers.ack_application_process !== 'true') missing.push('ack_application_process');
  if (answers.ack_sample_steps !== 'true') missing.push('ack_sample_steps');
  if (!hasResume) missing.push('resume');
  return missing;
}
