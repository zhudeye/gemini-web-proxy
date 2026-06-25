import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { GeminiTokenExtractor } from '../src/auth/token-extractor.js';
import { loadConfig } from '../src/config.js';
import { createFallbackModelRegistry } from '../src/models/registry.js';
import { SlidingWindowRateLimiter } from '../src/security/rate-limit.js';
import { createServer, type AppContext } from '../src/server.js';

let server: Server | undefined;

function testContext(rateLimitPerMinute = 20): AppContext {
  const config = loadConfig({
    NODE_ENV: 'test',
    GEMINI_COOKIE: '__Secure-1PSID=mock-sid; __Secure-1PSIDTS=mock-ts',
    API_KEYS: 'test-key',
    ALLOWED_ORIGINS: 'https://allowed.example',
    RATE_LIMIT_PER_MINUTE: String(rateLimitPerMinute),
  });
  return {
    config,
    modelRegistry: createFallbackModelRegistry(),
    tokenExtractor: new GeminiTokenExtractor({ geminiCookie: config.geminiCookie, geminiCookieTs: config.geminiCookieTs }),
    rateLimiter: new SlidingWindowRateLimiter(config.rateLimitPerMinute),
  };
}

function closeServer(instance: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    instance.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startTestServer(context: AppContext): Promise<string> {
  server = createServer(context);
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server !== undefined) {
    await closeServer(server);
    server = undefined;
  }
});

describe('security integration', () => {
  it('does not allow blocked CORS origins', async () => {
    const baseUrl = await startTestServer(testContext());
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: 'Bearer test-key', Origin: 'https://blocked.example' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate limits per API key and returns headers', async () => {
    const baseUrl = await startTestServer(testContext(1));
    const headers = { Authorization: 'Bearer test-key' };

    expect((await fetch(`${baseUrl}/v1/models`, { headers })).status).toBe(200);
    const limited = await fetch(`${baseUrl}/v1/models`, { headers });
    const body = await limited.json();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-ratelimit-limit-requests')).toBe('1');
    expect(body).toMatchObject({ error: { type: 'rate_limit_error', code: 'rate_limit_exceeded' } });
  });
});
