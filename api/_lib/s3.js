import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

export async function putObject(key, body, contentType) {
  if (fake) return fake.putObject(key, body, contentType);
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(key) {
  if (fake) return fake.deleteObject(key);
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export function useFakeS3(f) {
  fake = f;
}
