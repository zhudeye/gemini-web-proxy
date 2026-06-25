import type { OutgoingHttpHeaders } from 'node:http';

export function resolveAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): string | null {
  if (origin === undefined) {
    return null;
  }

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  return allowedOrigins.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | undefined, allowedOrigins: readonly string[]): OutgoingHttpHeaders {
  const allowedOrigin = resolveAllowedOrigin(origin, allowedOrigins);
  if (allowedOrigin === null) {
    return { Vary: 'Origin' };
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}
