// POST /api/resume/upload-url { fileName, size }
// Returns a short-lived S3 URL the browser uploads the resume to directly.
import { randomUUID } from 'node:crypto';
import { route, HttpError } from '../../lib/http.js';
import { MAX_RESUME_BYTES, RESUME_EXT } from '../../lib/questions.js';
import { requireApplication, requireDraft } from '../../lib/session.js';
import { KEY_PREFIX, presignUpload } from '../../lib/s3.js';

export default route({
  async POST(req, res, body) {
    const app = await requireApplication(req);
    requireDraft(app);
    const ext = String(body.fileName || '').split('.').pop().toLowerCase();
    const contentType = RESUME_EXT[ext];
    if (!contentType) throw new HttpError(400, 'bad_file_type', 'Resume must be a PDF, DOC or DOCX file');
    const size = Number(body.size);
    if (!(size > 0) || size > MAX_RESUME_BYTES) throw new HttpError(400, 'bad_file_size', 'Resume must be 10 MB or smaller');

    const key = `${KEY_PREFIX}/${app.id}/resume/${randomUUID()}.${ext}`;
    const url = await presignUpload(key, contentType);
    return { url, key, headers: { 'Content-Type': contentType } };
  },
});
