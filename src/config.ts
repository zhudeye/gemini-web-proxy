export type RuntimeEnvironment = 'development' | 'test' | 'production';

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

function validateUrl(name: string, value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    return url.toString();
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
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
  const geminiCookie = requiredValue('GEMINI_COOKIE', env['GEMINI_COOKIE'], isProduction, 'mock-gemini-cookie');
  const geminiCookieTs = requiredValue('GEMINI_COOKIE_TS', env['GEMINI_COOKIE_TS'], isProduction, 'mock-gemini-cookie-ts');
  const geminiEndpointRaw = requiredValue(
    'GEMINI_ENDPOINT',
    env['GEMINI_ENDPOINT'],
    isProduction,
    'https://gemini.google.com/_/mock/endpoint',
  );
  const apiKeys = parseList('API_KEYS', env['API_KEYS'], isProduction ? [] : ['test-key']);

  if (isProduction && apiKeys.length === 0) {
    throw new Error('Missing required environment variable: API_KEYS');
  }

  return {
    nodeEnv,
    port: parsePort(env['PORT']),
    geminiCookie,
    geminiCookieTs,
    geminiCookieCc: env['GEMINI_COOKIE_CC']?.trim() || undefined,
    geminiEndpoint: validateUrl('GEMINI_ENDPOINT', geminiEndpointRaw),
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

export const CONFIG = loadConfig();
export const PORT = CONFIG.port;
