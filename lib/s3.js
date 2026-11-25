import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpError } from './http.js';

export const KEY_PREFIX = 'red-team-applications';

let client = null;
let fake = null; // tests

export function bucket() {
  const b = process.env.S3_BUCKET;
  if (!b && !fake) throw new HttpError(503, 'storage_not_configured');
  return b || 'test-bucket';
}

function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || 'us-east-2',
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

// A short-lived URL the browser PUTs the file to directly, so large files
// never pass through the serverless function (Vercel caps request bodies at 4.5 MB).
export function presignUpload(key, contentType) {
  if (fake) return fake.presignUpload(key, contentType);
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 600 });
}

// Size of an uploaded object, or null if it isn't there.
export async function objectSize(key) {
  if (fake) return fake.objectSize(key);
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return Number(head.ContentLength);
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

export async function deleteObject(key) {
  if (fake) return fake.deleteObject(key);
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export function useFakeS3(f) {
  fake = f;
}
