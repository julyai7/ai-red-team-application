import { isConfigured } from './db.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const MAX_BODY = 64 * 1024;

export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > MAX_BODY) reject(new HttpError(413, 'too_large'));
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

export function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// The public site address, used for links in emails. Never taken from request
// headers, so a forged Host header can't redirect someone's login link.
export function siteUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return 'http://localhost:3000';
}

// Browsers send Origin on POST/PATCH; reject requests that come from another site.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host || o.origin === new URL(siteUrl()).origin;
  } catch {
    return false;
  }
}

// Wraps a handler: method check, "not configured" guard, origin check, errors as JSON.
export function route(handlers) {
  return async (req, res) => {
    const fn = handlers[req.method];
    if (!fn) {
      res.setHeader('Allow', Object.keys(handlers).join(', '));
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!isConfigured()) return send(res, 503, { error: 'not_configured' });
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });
    try {
      const body = req.method === 'GET' ? {} : await readJson(req);
      const out = await fn(req, res, body);
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message });
      console.error(err);
      send(res, 500, { error: 'server_error' });
    }
  };
}
