const COOKIE_PATTERN = /(__Secure-[^=;\s]+)=([^;\s]+)/g;
const AUTHORIZATION_HEADER_PATTERN = /Authorization:\s*Bearer\s+[^\r\n,}\s]+/gi;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

const SENSITIVE_QUERY_PARAMS = new Set(['token', 'key', 'at', 'auth', 'cookie', 'api_key', 'access_token']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactKnownSecrets(input: string, knownSecrets: readonly string[]): string {
  return knownSecrets.reduce((current, secret) => {
    if (secret.trim().length === 0) {
      return current;
    }

    return current.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }, input);
}

function redactPatternMatches(input: string): string {
  return input
    .replace(AUTHORIZATION_HEADER_PATTERN, 'Authorization: Bearer [REDACTED]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]')
    .replace(COOKIE_PATTERN, (_match, cookieName: string) => `${cookieName}=[REDACTED]`);
}

function redactUrlQueryParams(input: string): string {
  return input.replace(/https?:\/\/[^\s"'<>]+/g, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      for (const paramName of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_QUERY_PARAMS.has(paramName.toLowerCase())) {
          url.searchParams.set(paramName, '[REDACTED]');
        }
      }
      return url.toString();
    } catch {
      return rawUrl;
    }
  });
}

export function redactSecrets(value: unknown, knownSecrets: readonly string[] = []): string {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  const safeInput = input ?? '';

  return redactUrlQueryParams(redactPatternMatches(redactKnownSecrets(safeInput, knownSecrets)));
}
