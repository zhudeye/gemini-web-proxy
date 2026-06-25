import { redactSecrets } from '../security/redaction.js';

export interface GeminiCookieConfig {
  readonly geminiCookie: string;
  readonly geminiCookieTs: string;
  readonly geminiCookieCc?: string;
}

export interface GeminiWebTokens {
  readonly snlM0e: string;
  readonly cfb2h: string;
  readonly fdrFJe: string;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const GEMINI_APP_URL = 'https://gemini.google.com/app';

function firstMatch(html: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const token = match?.[1];
    if (token !== undefined && token.length > 0) {
      return token;
    }
  }

  return null;
}

function extractRequiredToken(html: string, name: string, patterns: readonly RegExp[]): string {
  const token = firstMatch(html, patterns);
  if (token === null) {
    throw new Error(`Unable to extract Gemini Web token: ${name}`);
  }

  return token;
}

export function extractGeminiWebTokens(html: string): GeminiWebTokens {
  return {
    snlM0e: extractRequiredToken(html, 'SNlM0e', [
      /"SNlM0e"\s*:\s*"([^"]+)"/,
      /\["SNlM0e"\s*,\s*"([^"]+)"\]/,
      /SNlM0e[^"']*["']([^"']{6,})["']/,
    ]),
    cfb2h: extractRequiredToken(html, 'cfb2h', [
      /"cfb2h"\s*:\s*"([^"]+)"/,
      /\["cfb2h"\s*,\s*"([^"]+)"\]/,
      /cfb2h[^"']*["']([^"']{6,})["']/,
    ]),
    fdrFJe: extractRequiredToken(html, 'FdrFJe', [
      /"FdrFJe"\s*:\s*"([^"]+)"/,
      /\["FdrFJe"\s*,\s*"([^"]+)"\]/,
      /FdrFJe[^"']*["']([^"']{6,})["']/,
    ]),
  };
}

export function buildGeminiCookieHeader(config: GeminiCookieConfig): string {
  const parts = [`__Secure-1PSID=${config.geminiCookie}`, `__Secure-1PSIDTS=${config.geminiCookieTs}`];
  if (config.geminiCookieCc !== undefined && config.geminiCookieCc.trim().length > 0) {
    parts.push(`__Secure-1PSIDCC=${config.geminiCookieCc.trim()}`);
  }

  return parts.join('; ');
}

export class GeminiTokenExtractor {
  private cachedTokens: GeminiWebTokens | null = null;

  constructor(
    private readonly cookies: GeminiCookieConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  getCachedTokens(): GeminiWebTokens | null {
    return this.cachedTokens;
  }

  clearCache(): void {
    this.cachedTokens = null;
  }

  async refresh(): Promise<GeminiWebTokens> {
    const cookieHeader = buildGeminiCookieHeader(this.cookies);
    const response = await this.fetchImpl(GEMINI_APP_URL, {
      method: 'GET',
      headers: {
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 GeminiWebProxy/0.1',
      },
    });

    if (!response.ok) {
      throw new Error(
        redactSecrets(`Gemini Web token page request failed with HTTP ${response.status}`, [cookieHeader, this.cookies.geminiCookie, this.cookies.geminiCookieTs]),
      );
    }

    const html = await response.text();
    try {
      this.cachedTokens = extractGeminiWebTokens(html);
      return this.cachedTokens;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown token extraction error';
      throw new Error(redactSecrets(message, [cookieHeader, this.cookies.geminiCookie, this.cookies.geminiCookieTs]));
    }
  }

  async getTokens(): Promise<GeminiWebTokens> {
    if (this.cachedTokens !== null) {
      return this.cachedTokens;
    }

    return this.refresh();
  }

  async refreshAfterAuthFailure(): Promise<GeminiWebTokens> {
    this.clearCache();
    return this.refresh();
  }
}
