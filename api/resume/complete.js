// POST /api/resume/complete { key, fileName }
// Called after the browser finishes uploading to S3. Checks the file really landed,
// records it, and replaces any earlier resume.
import { tx } from '../../lib/db.js';
import { route, HttpError } from '../../lib/http.js';
import { MAX_RESUME_BYTES, RESUME_EXT } from '../../lib/questions.js';
import { requireApplication, requireDraft } from '../../lib/session.js';
import { bucket, deleteObject, KEY_PREFIX, objectSize } from '../../lib/s3.js';

export default route({
  async POST(req, res, body) {
    const app = await requireApplication(req);
    requireDraft(app);

    const key = String(body.key || '');
    const m = new RegExp(`^${KEY_PREFIX}/${app.id}/resume/[0-9a-f-]{36}\\.(pdf|docx?)$`).exec(key);
    if (!m) throw new HttpError(400, 'bad_key');
    const contentType = RESUME_EXT[m[1]];
    const fileName = String(body.fileName || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200) || `resume.${m[1]}`;

    const size = await objectSize(key);
    if (size == null) throw new HttpError(400, 'upload_missing', 'The upload didn’t finish. Try again.');
    if (size > MAX_RESUME_BYTES) {
      await deleteObject(key).catch(() => {});
      throw new HttpError(400, 'bad_file_size', 'Resume must be 10 MB or smaller');
    }

    const replaced = await tx(async (db) => {
      const old = await db.query(
        `delete from red_team.documents where application_id = $1 and kind = 'resume' and s3_key <> $2 returning s3_key`,
        [app.id, key],
      );
      await db.query(
        `insert into red_team.documents (application_id, kind, s3_bucket, s3_key, file_name, content_type, size_bytes)
         values ($1, 'resume', $2, $3, $4, $5, $6)
         on conflict (s3_key) do nothing`,
        [app.id, bucket(), key, fileName, contentType, size],
      );
      await db.query('update red_team.applications set updated_at = now() where id = $1', [app.id]);
      return old.rows.map((r) => r.s3_key);
    });
    // Old files are no longer referenced; removing them is best effort.
    await Promise.all(replaced.map((k) => deleteObject(k).catch((e) => console.warn('S3 delete failed', k, e))));

    return { resume: { fileName, contentType, sizeBytes: size } };
  },
});
