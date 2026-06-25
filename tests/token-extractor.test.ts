import { describe, expect, it } from 'vitest';
import { buildGeminiCookieHeader, extractGeminiWebTokens, GeminiTokenExtractor, type FetchLike } from '../src/auth/token-extractor.js';

const fixtureHtml = `
<html>
  <script>window.APP_BOOTSTRAP={"SNlM0e":"token-snlm0e-value","cfb2h":"token-cfb2h-value","FdrFJe":"token-fdrfje-value"}</script>
</html>`;

describe('Gemini Web token extraction', () => {
  it('extracts SNlM0e, cfb2h, and FdrFJe from fixture HTML', () => {
    expect(extractGeminiWebTokens(fixtureHtml)).toEqual({
      snlM0e: 'token-snlm0e-value',
      cfb2h: 'token-cfb2h-value',
      fdrFJe: 'token-fdrfje-value',
    });
  });

  it('builds Gemini cookie header with optional CC value', () => {
    expect(
      buildGeminiCookieHeader({
        geminiCookie: 'cookie-value',
        geminiCookieTs: 'cookie-ts-value',
        geminiCookieCc: 'cookie-cc-value',
      }),
    ).toBe('__Secure-1PSID=cookie-value; __Secure-1PSIDTS=cookie-ts-value; __Secure-1PSIDCC=cookie-cc-value');
  });

  it('fetches the token page and caches tokens in memory', async () => {
    let callCount = 0;
    const fetchImpl: FetchLike = async () => {
      callCount += 1;
      return new Response(fixtureHtml, { status: 200 });
    };
    const extractor = new GeminiTokenExtractor({ geminiCookie: 'cookie-value', geminiCookieTs: 'cookie-ts-value' }, fetchImpl);

    await expect(extractor.getTokens()).resolves.toMatchObject({ snlM0e: 'token-snlm0e-value' });
    await expect(extractor.getTokens()).resolves.toMatchObject({ fdrFJe: 'token-fdrfje-value' });
    expect(callCount).toBe(1);
  });

  it('fails safely when upstream returns unauthorized status', async () => {
    const fetchImpl: FetchLike = async () => new Response('login required', { status: 403 });
    const extractor = new GeminiTokenExtractor({ geminiCookie: 'SECRET_COOKIE_VALUE', geminiCookieTs: 'SECRET_TS_VALUE' }, fetchImpl);

    await expect(extractor.refresh()).rejects.toThrow(/HTTP 403/);
    await expect(extractor.refresh()).rejects.not.toThrow(/SECRET_COOKIE_VALUE/);
  });

  it('fails safely when HTML is missing required tokens', () => {
    expect(() => extractGeminiWebTokens('<html>missing</html>')).toThrow(/SNlM0e/);
  });
});
