/**
 * July AI — Red Team application backend (Google Apps Script web app).
 *
 * Receives one JSON application per POST from apply.html, saves the resume to a
 * Drive folder, and appends a row to a Google Sheet. Setup steps: see README.md.
 */

// 1. Paste the ID of the Google Sheet that should collect applications
//    (the long string between /d/ and /edit in its URL).
const SHEET_ID = 'PASTE_SHEET_ID_HERE';
// 2. Paste the ID of the Drive folder for resumes (the last part of the folder's URL).
const RESUME_FOLDER_ID = 'PASTE_FOLDER_ID_HERE';
// Tab name inside the sheet. Created on first submission if missing.
const SHEET_NAME = 'Applications';

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx'];

const HEADERS = [
  'Submitted at', 'First name', 'Last name', 'Email', 'Phone',
  'How did you hear about July AI?', 'Authorized to work in the U.S.?',
  'Acknowledged sample is part of application', 'Confirmed sample steps', 'Status',
  'Resume', 'Resume file name',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Server-side checks mirror the form's required fields.
    const required = ['firstName', 'lastName', 'email', 'source', 'workAuth'];
    for (const k of required) {
      if (!d[k] || !String(d[k]).trim()) return json_({ ok: false, error: 'Missing ' + k });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return json_({ ok: false, error: 'Invalid email' });
    if (!d.ackApplicationProcess || !d.ackSampleSteps) return json_({ ok: false, error: 'Acknowledgements required' });
    if (!d.resume || !d.resume.data) return json_({ ok: false, error: 'Resume required' });

    const ext = String(d.resume.name || '').split('.').pop().toLowerCase();
    if (ALLOWED_EXT.indexOf(ext) === -1) return json_({ ok: false, error: 'Resume must be PDF, DOC or DOCX' });
    const bytes = Utilities.base64Decode(d.resume.data);
    if (bytes.length > MAX_RESUME_BYTES) return json_({ ok: false, error: 'Resume too large' });

    const safe = s => String(s || '').replace(/[^\w.\- ]+/g, '').trim().slice(0, 60);
    const fileName = [safe(d.lastName), safe(d.firstName), new Date().toISOString().slice(0, 10)].join('_') + '.' + ext;
    const file = DriveApp.getFolderById(RESUME_FOLDER_ID)
      .createFile(Utilities.newBlob(bytes, d.resume.type || 'application/octet-stream', fileName));

    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    }
    // Prefix with ' so values starting with = + - @ are stored as text, not formulas.
    const cell = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);
    sheet.appendRow([
      new Date(),
      d.firstName, d.lastName, d.email, d.phone || '',
      d.source, d.workAuth,
      d.ackApplicationProcess ? 'Yes' : 'No',
      d.ackSampleSteps ? 'Yes' : 'No',
      d.status || 'Sample pending',
      file.getUrl(), d.resume.name,
    ].map(cell));

    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Server error' });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Lets you open the web app URL in a browser to check it's live.
function doGet() {
  return json_({ ok: true, service: 'july-red-team-application' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
