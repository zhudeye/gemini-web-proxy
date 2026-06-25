import type { IncomingMessage } from 'node:http';
import { invalidRequest } from '../openai/errors.js';

export async function readJsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw invalidRequest('Request body is too large', 'request_body_too_large');
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) {
    throw invalidRequest('Request body must not be empty', 'empty_request_body');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalidRequest('Request body must be valid JSON', 'invalid_json');
  }
}
