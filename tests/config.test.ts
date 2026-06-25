import { describe, expect, it } from 'vitest';
import { loadConfig, parseCombinedCookie } from '../src/config.js';

describe('parseCombinedCookie', () => {
  it('extracts all three cookie values from a combined string', () => {
    const result = parseCombinedCookie('__Secure-1PSID=abc; __Secure-1PSIDTS=def; __Secure-1PSIDCC=ghi');

    expect(result.geminiCookie).toBe('abc');
    expect(result.geminiCookieTs).toBe('def');
    expect(result.geminiCookieCc).toBe('ghi');
  });

  it('handles missing __Secure-1PSIDCC as optional', () => {
    const result = parseCombinedCookie('__Secure-1PSID=abc; __Secure-1PSIDTS=def');

    expect(result.geminiCookie).toBe('abc');
    expect(result.geminiCookieTs).toBe('def');
    expect(result.geminiCookieCc).toBeUndefined();
  });

  it('throws when __Secure-1PSID is missing', () => {
    expect(() => parseCombinedCookie('__Secure-1PSIDTS=def')).toThrow(/__Secure-1PSID/);
  });

  it('throws when __Secure-1PSIDTS is missing', () => {
    expect(() => parseCombinedCookie('__Secure-1PSID=abc')).toThrow(/__Secure-1PSIDTS/);
  });

  it('handles leading/trailing whitespace in the raw string', () => {
    const result = parseCombinedCookie('  __Secure-1PSID=abc ;  __Secure-1PSIDTS=def  ');

    expect(result.geminiCookie).toBe('abc');
    expect(result.geminiCookieTs).toBe('def');
  });
});

describe('loadConfig', () => {
  it('fails explicitly when production secrets are missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/GEMINI_COOKIE/);
  });

  it('allows defaults outside production', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(8080);
    expect(config.apiKeys).toEqual(['test-key']);
    expect(config.geminiEndpoint).toBe(''); // auto-build from tokens
    expect(config.geminiCookie).toBe('mock');
    expect(config.geminiCookieTs).toBe('mock');
  });

  it('validates port and rate limit', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '0' })).toThrow(/RATE_LIMIT_PER_MINUTE/);
  });

  it('validates GEMINI_ENDPOINT when explicitly set to an invalid URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', GEMINI_ENDPOINT: 'not-a-url' })).toThrow(/GEMINI_ENDPOINT/);
  });

  it('parses combined GEMINI_COOKIE in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      GEMINI_COOKIE: '__Secure-1PSID=prod-sid; __Secure-1PSIDTS=prod-ts; __Secure-1PSIDCC=prod-cc',
      API_KEYS: 'sk-prod-key',
    });

    expect(config.geminiCookie).toBe('prod-sid');
    expect(config.geminiCookieTs).toBe('prod-ts');
    expect(config.geminiCookieCc).toBe('prod-cc');
    expect(config.geminiEndpoint).toBe(''); // auto-build
  });

  it('accepts explicit GEMINI_ENDPOINT when provided', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      GEMINI_COOKIE: '__Secure-1PSID=sid; __Secure-1PSIDTS=ts',
      API_KEYS: 'sk-key',
      GEMINI_ENDPOINT: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    });

    expect(config.geminiEndpoint).toContain('StreamGenerate');
  });

  it('trims API keys and rejects empty entries', () => {
    expect(loadConfig({ NODE_ENV: 'test', API_KEYS: ' alpha , beta ' }).apiKeys).toEqual(['alpha', 'beta']);
    expect(() => loadConfig({ NODE_ENV: 'test', API_KEYS: 'alpha, ,beta' })).toThrow(/API_KEYS/);
  });
});
