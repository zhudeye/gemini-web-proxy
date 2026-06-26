import { describe, expect, it } from 'vitest';
import type { GeminiWebTokens } from '../src/auth/token-extractor.js';
import type { GeminiModelMapping } from '../src/models/registry.js';
import { buildModelHeaders } from '../src/models/registry.js';
import { parseChatCompletionRequest } from '../src/openai/types.js';
import { buildGeminiEndpointUrl, buildGeminiInnerRequest, buildGeminiRequestBody } from '../src/transform/request-builder.js';

const tokens: GeminiWebTokens = {
  snlM0e: 'token-snlm0e-value',
  cfb2h: 'token-cfb2h-value',
  fdrFJe: 'token-fdrfje-value',
};

const model: GeminiModelMapping = {
  id: 'gemini-web',
  upstreamModelId: 'gemini-2.0-flash-exp',
  modelHeaders: buildModelHeaders('fbb127bbb056c959', 1),
  ownedBy: 'google',
  discovered: false,
};

describe('Gemini Web request builder', () => {
  it('converts basic OpenAI messages to f.req form body', () => {
    const request = parseChatCompletionRequest({
      model: 'gemini-web',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Continue' },
      ],
      stream: true,
      temperature: 0.7,
    });

    const result = buildGeminiRequestBody(request, tokens, model);
    const params = new URLSearchParams(result.body);

    expect(params.get('at')).toBe('token-snlm0e-value');

    // f.req should be [null,"<json_encoded_inner_array>"]
    const fReqRaw = params.get('f.req');
    expect(fReqRaw).toContain('Continue');

    // Parse the outer structure: [null, innerJsonString]
    const outerParsed = JSON.parse(fReqRaw!);
    expect(outerParsed).toHaveLength(2);
    expect(outerParsed[0]).toBeNull();
    expect(typeof outerParsed[1]).toBe('string');

    // Parse the inner JSON array
    const innerParsed = JSON.parse(outerParsed[1]);
    expect(Array.isArray(innerParsed)).toBe(true);
    expect(innerParsed).toHaveLength(69);

    // [0] should contain the message text
    expect(innerParsed[0][0]).toBe('Continue');

    // [7] should be 1 (streaming)
    expect(innerParsed[7]).toBe(1);

    // [59] should be a UUID
    expect(innerParsed[59]).toMatch(/^[0-9A-F-]{36}$/);

    expect(result.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
    expect(result.headers['Origin']).toBe('https://gemini.google.com');
    expect(result.headers['Referer']).toBe('https://gemini.google.com/');
    expect(result.headers['X-Same-Domain']).toBe('1');
    expect(result.headers['x-goog-ext-525001261-jspb']).toBeDefined();
    expect(result.headers['x-goog-ext-73010989-jspb']).toBe('[0]');
    expect(result.headers['x-goog-ext-525005358-jspb']).toBeDefined();

    // Verify UUID matches between header and internal array
    const uuidHeader = JSON.parse(result.headers['x-goog-ext-525005358-jspb']);
    expect(uuidHeader[0]).toBe(innerParsed[59]);
    expect(uuidHeader[1]).toBe(1);
  });

  it('prepends system messages to the first user message', () => {
    const request = parseChatCompletionRequest({
      model: 'gemini-web',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Explain Render.' },
      ],
    });

    const innerRequest = buildGeminiInnerRequest(request, 'TEST-UUID-0000-0000-000000000000');
    const encoded = JSON.stringify(innerRequest);

    expect(encoded).toContain('System instructions');
    expect(encoded).toContain('Be concise.');
    expect(encoded).toContain('User message');
    expect(encoded).toContain('Explain Render.');
  });

  it('rejects image content before building a Gemini request body', () => {
    expect(() =>
      parseChatCompletionRequest({
        model: 'gemini-web',
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] }],
      }),
    ).toThrow(/Only text message content/);
  });
});

describe('buildGeminiEndpointUrl', () => {
  it('builds a valid StreamGenerate URL with tokens', () => {
    const url = buildGeminiEndpointUrl(tokens, 'en');

    expect(url).toContain('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate');
    expect(url).toContain('bl=token-cfb2h-value');
    expect(url).toContain('f.sid=token-fdrfje-value');
    expect(url).toContain('hl=en');
    expect(url).toContain('rt=c');
    expect(url).toContain('_reqid=');
  });

  it('accepts a language override', () => {
    const url = buildGeminiEndpointUrl(tokens, 'zh-CN');

    expect(url).toContain('hl=zh-CN');
  });

  it('generates unique _reqid values on subsequent calls', () => {
    const url1 = buildGeminiEndpointUrl(tokens);
    const url2 = buildGeminiEndpointUrl(tokens);

    const reqId1 = new URL(url1).searchParams.get('_reqid');
    const reqId2 = new URL(url2).searchParams.get('_reqid');

    expect(reqId1).not.toBe(reqId2);
  });
});
