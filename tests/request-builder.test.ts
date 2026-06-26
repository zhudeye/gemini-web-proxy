import { describe, expect, it } from 'vitest';
import type { GeminiWebTokens } from '../src/auth/token-extractor.js';
import type { GeminiModelMapping } from '../src/models/registry.js';
import { parseChatCompletionRequest } from '../src/openai/types.js';
import { buildGeminiEndpointUrl, buildGeminiFReq, buildGeminiRequestBody } from '../src/transform/request-builder.js';

const tokens: GeminiWebTokens = {
  snlM0e: 'token-snlm0e-value',
  cfb2h: 'token-cfb2h-value',
  fdrFJe: 'token-fdrfje-value',
};

const model: GeminiModelMapping = {
  id: 'gemini-web',
  upstreamModelId: 'upstream-model-id',
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
    expect(params.get('f.req')).toContain('Hello');
    expect(result.fReq[1]).toBe('upstream-model-id');
    expect(result.fReq[7]).toBe(1);
    expect(result.fReq[8]).toBe(0.7);
    expect(result.fReq[45]).toBe(1);
    expect(result.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  it('prepends system messages to the first user message', () => {
    const request = parseChatCompletionRequest({
      model: 'gemini-web',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Explain Render.' },
      ],
    });

    const fReq = buildGeminiFReq(request, model);
    const encoded = JSON.stringify(fReq);

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
  it('builds a valid batchexecute URL with tokens and rpcids', () => {
    const url = buildGeminiEndpointUrl(tokens, 'en');

    expect(url).toContain('https://gemini.google.com/_/BardChatUi/data/batchexecute');
    expect(url).toContain('rpcids=aPya6c');
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
