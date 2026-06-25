import { describe, expect, it } from 'vitest';
import { openAIErrorBody, OpenAIHttpError } from '../src/openai/errors.js';
import { parseChatCompletionRequest } from '../src/openai/types.js';
import { requireBearerAuth } from '../src/security/auth.js';
import { corsHeaders } from '../src/security/cors.js';
import { rateLimitHeaders, SlidingWindowRateLimiter } from '../src/security/rate-limit.js';

describe('OpenAI-compatible request primitives', () => {
  it('returns OpenAI-style auth errors for missing bearer token', () => {
    try {
      requireBearerAuth({}, ['test-key']);
      throw new Error('expected auth failure');
    } catch (error) {
      if (!(error instanceof OpenAIHttpError)) {
        throw error;
      }
      expect(openAIErrorBody(error)).toMatchObject({ error: { type: 'authentication_error' } });
    }
  });

  it('rejects unsupported multimodal content before upstream calls', () => {
    expect(() =>
      parseChatCompletionRequest({
        model: 'gemini-web',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }],
      }),
    ).toThrow(/Only text message content/);
  });

  it('resolves CORS headers only for allowed origins', () => {
    expect(corsHeaders('https://allowed.example', ['https://allowed.example'])).toMatchObject({
      'Access-Control-Allow-Origin': 'https://allowed.example',
    });
    expect(corsHeaders('https://blocked.example', ['https://allowed.example'])).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('enforces sliding-window rate limits and exposes headers', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    expect(limiter.check('key', 1_000).allowed).toBe(true);
    const second = limiter.check('key', 2_000);
    expect(second.allowed).toBe(true);
    expect(rateLimitHeaders(second)).toMatchObject({
      'x-ratelimit-limit-requests': '2',
      'x-ratelimit-remaining-requests': '0',
    });
    expect(limiter.check('key', 3_000).allowed).toBe(false);
  });
});
