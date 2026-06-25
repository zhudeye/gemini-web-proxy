import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/security/redaction.js';

describe('redactSecrets', () => {
  it('redacts known secret substrings', () => {
    const redacted = redactSecrets('cookie=SECRET_COOKIE_VALUE api=SECRET_API_KEY_VALUE', [
      'SECRET_COOKIE_VALUE',
      'SECRET_API_KEY_VALUE',
    ]);

    expect(redacted).not.toContain('SECRET_COOKIE_VALUE');
    expect(redacted).not.toContain('SECRET_API_KEY_VALUE');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts bearer tokens and sensitive URL params', () => {
    const redacted = redactSecrets(
      'Authorization: Bearer abcdefghijklmnop https://example.test/path?at=secret-token&safe=value&key=secret-key',
    );

    expect(redacted).toContain('Authorization: Bearer [REDACTED]');
    expect(redacted).toContain('safe=value');
    expect(redacted).not.toContain('secret-token');
    expect(redacted).not.toContain('secret-key');
  });
});
