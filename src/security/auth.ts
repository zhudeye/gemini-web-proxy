import type { IncomingHttpHeaders } from 'node:http';
import { authenticationError } from '../openai/errors.js';

export function extractBearerToken(headers: IncomingHttpHeaders): string {
  const authorization = headers['authorization'];
  const value = Array.isArray(authorization) ? authorization[0] : authorization;

  if (value === undefined) {
    throw authenticationError('Missing Authorization bearer token');
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (match?.[1] === undefined || match[1].trim().length === 0) {
    throw authenticationError('Invalid Authorization bearer token');
  }

  return match[1].trim();
}

export function requireBearerAuth(headers: IncomingHttpHeaders, apiKeys: readonly string[]): string {
  const token = extractBearerToken(headers);
  if (!apiKeys.includes(token)) {
    throw authenticationError('Invalid bearer token');
  }

  return token;
}
