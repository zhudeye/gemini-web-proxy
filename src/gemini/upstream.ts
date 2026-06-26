import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import type { AppConfig } from '../config.js';
import type { GeminiTokenExtractor } from '../auth/token-extractor.js';
import type { GeminiModelMapping } from '../models/registry.js';
import type { ChatCompletionRequest } from '../openai/types.js';
import { buildGeminiEndpointUrl, buildGeminiRequestBody } from '../transform/request-builder.js';
import { GeminiFrameParser, type GeminiFrameEvent } from '../transform/frame-parser.js';
import { browserHeaders } from '../security/headers.js';

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

  // Merge browser-like headers to reduce automation detection risk
  const upstreamHeaders = {
    ...geminiRequest.headers,
    ...browserHeaders(),
  };

  let response: Response;

  if (options.config.geminiProxy) {
    const proxyAgent = new ProxyAgent(options.config.geminiProxy);
    try {
      response = await undiciFetch(endpointUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: geminiRequest.body,
        signal: options.signal,
        dispatcher: proxyAgent,
      } as any);
    } finally {
      proxyAgent.close();
    }
  } else {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: upstreamHeaders,
      body: geminiRequest.body,
      signal: options.signal,
    });
  }

  if (!response.ok) {
    // Try to read error body for diagnostics
    let detail = '';
    try {
      const text = await response.text();
      detail = text.length > 200 ? text.slice(0, 200) + '...' : text;
    } catch { /* ignore */ }

    // 429 = rate limited — likely cookie expired or too many requests
    if (response.status === 429) {
      process.stderr.write(
        `[WARN] Gemini upstream returned 429 — cookie may be expiring or rate limited. ` +
        `Consider rotating __Secure-1PSID cookies.\n`,
      );
    }

    yield {
      type: 'error',
      code: String(response.status),
      message: detail
        ? `Gemini upstream failed with HTTP ${response.status}: ${detail}`
        : `Gemini upstream failed with HTTP ${response.status}`,
    };
    return;
  }

  if (response.body === null) {
    yield { type: 'error', code: 'empty_upstream_body', message: 'Gemini upstream returned an empty body' };
    return;
  }

  const parser = new GeminiFrameParser();
  const decoder = new TextDecoder();
  let rawText = '';
  let yieldedCount = 0;

  for await (const chunk of response.body) {
    const text = decoder.decode(chunk, { stream: true });
    rawText += text;
    for (const event of parser.push(text)) {
      yieldedCount++;
      yield event;
    }
  }

  for (const event of parser.flush()) {
    yieldedCount++;
    yield event;
  }

  // If GEMINI_DUMP is set, write raw response to disk for debugging
  const dumpDir = process.env['GEMINI_DUMP'];
  if (dumpDir && rawText.length > 0) {
    const ts = Date.now();
    const dumpPath = join(dumpDir, `gemini-raw-${ts}.txt`);
    try {
      if (!existsSync(dumpDir)) {
        mkdirSync(dumpDir, { recursive: true });
      }
      appendFileSync(dumpPath, rawText, 'utf-8');
      process.stderr.write(`[dump] Raw Gemini response written to ${dumpPath}\n`);
    } catch (err) {
      process.stderr.write(`[dump] Failed to write raw response: ${err}\n`);
    }
  }

  // If parser produced no events, emit a diagnostic error
  if (yieldedCount === 0 && rawText.length > 0) {
    const preview = rawText.length > 500 ? rawText.slice(0, 500) + '...' : rawText;
    yield {
      type: 'error',
      code: 'empty_response',
      message: `Gemini returned no parseable events. Raw response preview: ${preview}`,
    };
  }
}
