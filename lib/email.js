// Sends email through SendGrid's API (the same provider the July app uses).

function parseFrom(v) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(v || '');
  return m ? { name: m[1] || undefined, email: m[2] } : { email: String(v || '').trim() };
}

let fake = null; // tests

export async function sendEmail({ to, subject, text, html }) {
  if (fake) return fake({ to, subject, text, html });
  const key = process.env.SENDGRID_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error('SENDGRID_API_KEY and EMAIL_FROM must be set');
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: parseFrom(from),
      subject,
      content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
      // Keep the login link as-is instead of routing it through SendGrid's click tracker.
      tracking_settings: { click_tracking: { enable: false, enable_text: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text().catch(() => '')}`);
}

export function useFakeEmail(f) {
  fake = f;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loginEmail(link, submitted) {
  const subject = submitted ? 'Your July AI application' : 'Continue your July AI application';
  const lead = submitted
    ? 'You’ve already submitted your Red Team contributor application. Use the link below to see its status and the steps for your sample submissions.'
    : 'Use the link below to pick up your Red Team contributor application where you left off.';
  const text = `${lead}\n\n${link}\n\nThe link works once and expires in 30 minutes. If you didn’t ask for it, you can ignore this email.\n\nJuly AI`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#10131f;max-width:520px">
  <p>${esc(lead)}</p>
  <p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#1e4fd8;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">${submitted ? 'View your application' : 'Continue application'}</a></p>
  <p style="color:#5d606c;font-size:13px">The link works once and expires in 30 minutes. If you didn’t ask for it, you can ignore this email.</p>
  <p style="color:#5d606c;font-size:13px">July AI</p>
</div>`;
  return { subject, text, html };
}
