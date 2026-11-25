// POST /api/resume  (body: the file itself; header X-File-Name: URI-encoded file name)
// Saves the resume to S3 and records it, replacing any earlier resume.
import { randomUUID } from 'node:crypto';
import { tx } from '../lib/db.js';
import { route, readRaw, HttpError } from '../lib/http.js';
import { MAX_RESUME_BYTES, RESUME_EXT } from '../lib/questions.js';
import { requireApplication, requireDraft } from '../lib/session.js';
import { bucket, deleteObject, KEY_PREFIX, putObject } from '../lib/s3.js';

const TOO_BIG = 'Resume must be ' + MAX_RESUME_BYTES / 1024 / 1024 + ' MB or smaller';

function fileNameFrom(req) {
  let name = String(req.headers['x-file-name'] || '');
  try { name = decodeURIComponent(name); } catch { /* keep as sent */ }
  return name.replace(/[\u0000-\u001f\\/]/g, '').trim().slice(0, 200);
}

export default route({
  async POST(req) {
    const app = await requireApplication(req);
    requireDraft(app);

    const fileName = fileNameFrom(req);
    const ext = fileName.split('.').pop().toLowerCase();
    const contentType = RESUME_EXT[ext];
    if (!fileName || !contentType) throw new HttpError(400, 'bad_file_type', 'Resume must be a PDF, DOC or DOCX file');
    if (Number(req.headers['content-length']) > MAX_RESUME_BYTES) throw new HttpError(413, 'too_large', TOO_BIG);

    let body;
    try { body = await readRaw(req, MAX_RESUME_BYTES); } catch (e) {
      if (e instanceof HttpError) throw new HttpError(413, 'too_large', TOO_BIG);
      throw e;
    }
    if (!body.length) throw new HttpError(400, 'empty_file', 'That file is empty');

    const key = `${KEY_PREFIX}/${app.id}/resume/${randomUUID()}.${ext}`;
    await putObject(key, body, contentType);

    const replaced = await tx(async (db) => {
      const old = await db.query(
        `delete from red_team.documents where application_id = $1 and kind = 'resume' returning s3_key`,
        [app.id],
      );
      await db.query(
        `insert into red_team.documents (application_id, kind, s3_bucket, s3_key, file_name, content_type, size_bytes)
         values ($1, 'resume', $2, $3, $4, $5, $6)`,
        [app.id, bucket(), key, fileName, contentType, body.length],
      );
      await db.query('update red_team.applications set updated_at = now() where id = $1', [app.id]);
      return old.rows.map((r) => r.s3_key);
    });
    // Old files are no longer referenced; removing them is best effort.
    await Promise.all(replaced.map((k) => deleteObject(k).catch((e) => console.warn('S3 delete failed', k, e))));

    return { resume: { fileName, contentType, sizeBytes: body.length } };
  },
}, { raw: true });
