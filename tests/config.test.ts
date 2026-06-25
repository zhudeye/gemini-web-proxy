import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('fails explicitly when production secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/GEMINI_COOKIE/);
  });

  it('allows mock defaults outside production', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(8080);
    expect(config.apiKeys).toEqual(['test-key']);
    expect(config.geminiEndpoint).toBe('https://gemini.google.com/_/mock/endpoint');
  });

  it('validates port, rate limit, and endpoint', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '0' })).toThrow(/RATE_LIMIT_PER_MINUTE/);
    expect(() => loadConfig({ NODE_ENV: 'test', GEMINI_ENDPOINT: 'not-a-url' })).toThrow(/GEMINI_ENDPOINT/);
  });

  it('trims API keys and rejects empty entries', () => {
    expect(loadConfig({ NODE_ENV: 'test', API_KEYS: ' alpha , beta ' }).apiKeys).toEqual(['alpha', 'beta']);
    expect(() => loadConfig({ NODE_ENV: 'test', API_KEYS: 'alpha, ,beta' })).toThrow(/API_KEYS/);
  });
});
