export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface ParsedCookies {
  readonly geminiCookie: string;
  readonly geminiCookieTs: string;
  readonly geminiCookieCc?: string;
}

export interface AppConfig {
  readonly nodeEnv: RuntimeEnvironment;
  readonly port: number;
  readonly geminiCookie: string;
  readonly geminiCookieTs: string;
  readonly geminiCookieCc?: string;
  readonly geminiEndpoint: string;
  readonly apiKeys: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly rateLimitPerMinute: number;
  readonly isProduction: boolean;
}

const DEFAULT_PORT = 8080;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'] as const;

/**
 * Parse a combined cookie string into individual cookie values.
 *
 * Expected format: "__Secure-1PSID=xxx; __Secure-1PSIDTS=yyy; __Secure-1PSIDCC=zzz"
 * The __Secure-1PSIDCC part is optional.
 */
export function parseCombinedCookie(rawCookie: string): ParsedCookies {
  const entries: Record<string, string> = {};

  for (const part of rawCookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (name.length > 0 && value.length > 0) {
      entries[name] = value;
    }
  }

  const geminiCookie = entries['__Secure-1PSID'];
  const geminiCookieTs = entries['__Secure-1PSIDTS'];

  if (!geminiCookie || geminiCookie.length === 0) {
    throw new Error('GEMINI_COOKIE: missing __Secure-1PSID');
  }
  if (!geminiCookieTs || geminiCookieTs.length === 0) {
    throw new Error('GEMINI_COOKIE: missing __Secure-1PSIDTS');
  }

  return {
    geminiCookie,
    geminiCookieTs,
    geminiCookieCc: entries['__Secure-1PSIDCC'],
  };
}

function normalizeNodeEnv(value: string | undefined): RuntimeEnvironment {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }

  return 'development';
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parsePort(value: string | undefined): number {
  const port = parsePositiveInteger('PORT', value, DEFAULT_PORT);
  if (port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  return port;
}

function parseList(name: string, value: string | undefined, fallback: readonly string[] = []): readonly string[] {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const rawParts = value.split(',');
  const trimmed = rawParts.map((part) => part.trim());
  if (trimmed.some((part) => part.length === 0)) {
    throw new Error(`${name} must not contain empty entries`);
  }

  return trimmed;
}

function requiredValue(name: string, value: string | undefined, isProduction: boolean, fallback: string): string {
  if (value !== undefined && value.trim() !== '') {
    return value.trim();
  }

  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = normalizeNodeEnv(env['NODE_ENV']);
  const isProduction = nodeEnv === 'production';

  // Parse combined cookie or use legacy separate env vars
  const rawCookie = requiredValue('GEMINI_COOKIE', env['GEMINI_COOKIE'], isProduction, '__Secure-1PSID=mock; __Secure-1PSIDTS=mock');
  const parsed = parseCombinedCookie(rawCookie);

  const geminiCookie = parsed.geminiCookie;
  const geminiCookieTs = parsed.geminiCookieTs;
  const geminiCookieCc = parsed.geminiCookieCc;

  // If GEMINI_ENDPOINT is explicitly set, validate it; otherwise use empty string (auto-build)
  const geminiEndpointRaw = env['GEMINI_ENDPOINT']?.trim() ?? '';
  const geminiEndpoint = (geminiEndpointRaw.length > 0) ? validateUrl(geminiEndpointRaw) : '';

  const apiKeys = parseList('API_KEYS', env['API_KEYS'], isProduction ? [] : ['test-key']);

  if (isProduction && apiKeys.length === 0) {
    throw new Error('Missing required environment variable: API_KEYS');
  }

  return {
    nodeEnv,
    port: parsePort(env['PORT']),
    geminiCookie,
    geminiCookieTs,
    geminiCookieCc,
    geminiEndpoint,
    apiKeys,
    allowedOrigins: parseList('ALLOWED_ORIGINS', env['ALLOWED_ORIGINS'], DEFAULT_ALLOWED_ORIGINS),
    rateLimitPerMinute: parsePositiveInteger(
      'RATE_LIMIT_PER_MINUTE',
      env['RATE_LIMIT_PER_MINUTE'],
      DEFAULT_RATE_LIMIT_PER_MINUTE,
    ),
    isProduction,
  };
}

function validateUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error('GEMINI_ENDPOINT must be a valid HTTP(S) URL');
  }
}

export const CONFIG = loadConfig();
export const PORT = CONFIG.port;
