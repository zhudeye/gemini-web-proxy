import type { AppConfig } from '../config.js';
import type { GeminiTokenExtractor } from '../auth/token-extractor.js';
import type { GeminiModelMapping } from '../models/registry.js';
import type { ChatCompletionRequest } from '../openai/types.js';
import { buildGeminiEndpointUrl, buildGeminiRequestBody } from '../transform/request-builder.js';
import { GeminiFrameParser, type GeminiFrameEvent } from '../transform/frame-parser.js';

export interface GeminiGenerateOptions {
  readonly config: AppConfig;
  readonly tokenExtractor: GeminiTokenExtractor;
  readonly request: ChatCompletionRequest;
  readonly model: GeminiModelMapping;
  readonly signal?: AbortSignal;
}

function latestUserMessage(request: ChatCompletionRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.at(-1)?.content ?? 'Hello';
}

export async function* generateGeminiEvents(options: GeminiGenerateOptions): AsyncGenerator<GeminiFrameEvent> {
  // Non-production with no explicit endpoint -> use mock response for tests
  if (options.config.nodeEnv !== 'production' && !options.config.geminiEndpoint) {
    yield { type: 'delta', text: `Mock Gemini response to: ${latestUserMessage(options.request)}`, fullText: `Mock Gemini response to: ${latestUserMessage(options.request)}` };
    return;
  }

  const tokens = await options.tokenExtractor.getTokens();

  // Build endpoint URL: use provided endpoint, or auto-build from tokens
  const endpointUrl = options.config.geminiEndpoint || buildGeminiEndpointUrl(tokens);

  const geminiRequest = buildGeminiRequestBody(options.request, tokens, options.model);
  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: geminiRequest.headers,
    body: geminiRequest.body,
    signal: options.signal,
  });

  if (!response.ok) {
    yield { type: 'error', code: String(response.status), message: `Gemini upstream failed with HTTP ${response.status}` };
    return;
  }

  if (response.body === null) {
    yield { type: 'error', code: 'empty_upstream_body', message: 'Gemini upstream returned an empty body' };
    return;
  }

  const parser = new GeminiFrameParser();
  const decoder = new TextDecoder();

  for await (const chunk of response.body) {
    const text = decoder.decode(chunk, { stream: true });
    for (const event of parser.push(text)) {
      yield event;
    }
  }

  for (const event of parser.flush()) {
    yield event;
  }
}
