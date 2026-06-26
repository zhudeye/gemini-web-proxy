import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { CONFIG, type AppConfig } from './config.js';
import { GeminiTokenExtractor, type FetchLike } from './auth/token-extractor.js';
import { generateGeminiEvents } from './gemini/upstream.js';
import { readJsonBody } from './http/json-body.js';
import { createFallbackModelRegistry, type ModelRegistry } from './models/registry.js';
import { OpenAIHttpError, openAIErrorBody, rateLimitError } from './openai/errors.js';
import { parseChatCompletionRequest } from './openai/types.js';
import { requireBearerAuth } from './security/auth.js';
import { corsHeaders } from './security/cors.js';
import { rateLimitHeaders, SlidingWindowRateLimiter } from './security/rate-limit.js';
import { redactSecrets } from './security/redaction.js';

const SERVICE_NAME = 'gemini-web';

export interface AppContext {
  readonly config: AppConfig;
  readonly modelRegistry: ModelRegistry;
  readonly tokenExtractor: GeminiTokenExtractor;
  readonly rateLimiter: SlidingWindowRateLimiter;
}

function createProxyAwareFetch(proxyUrl: string): FetchLike {
  const agent = new ProxyAgent(proxyUrl);
  return (input, init) => undiciFetch(input, { ...init, dispatcher: agent });
}

function createDefaultContext(config: AppConfig = CONFIG): AppContext {
  const fetchImpl: FetchLike = config.geminiProxy
    ? createProxyAwareFetch(config.geminiProxy)
    : fetch;

  return {
    config,
    modelRegistry: createFallbackModelRegistry(),
    tokenExtractor: new GeminiTokenExtractor({
      geminiCookie: config.geminiCookie,
      geminiCookieTs: config.geminiCookieTs,
      geminiCookieCc: config.geminiCookieCc,
    }, fetchImpl),
    rateLimiter: new SlidingWindowRateLimiter(config.rateLimitPerMinute),
  };
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res: ServerResponse, allowedMethods: readonly string[]): void {
  sendJson(
    res,
    405,
    {
      error: {
        message: 'Method not allowed',
        type: 'invalid_request_error',
        code: 'method_not_allowed',
      },
    },
    { Allow: allowedMethods.join(', ') },
  );
}

function sendOpenAIError(res: ServerResponse, error: OpenAIHttpError, headers: http.OutgoingHttpHeaders = {}): void {
  sendJson(res, error.statusCode, openAIErrorBody(error), headers);
}

async function writeWithBackpressure(res: ServerResponse, chunk: string): Promise<void> {
  if (res.write(chunk)) {
    return;
  }

  await once(res, 'drain');
}

async function writeSseEvent(res: ServerResponse, payload: unknown): Promise<void> {
  await writeWithBackpressure(res, `data: ${JSON.stringify(payload)}\n\n`);
}

function toServerError(error: unknown): OpenAIHttpError {
  if (error instanceof OpenAIHttpError) {
    return error;
  }

  const message = error instanceof Error ? redactSecrets(error.message) : 'Internal server error';
  return new OpenAIHttpError(500, message, 'server_error', 'internal_error');
}

function requestCorsHeaders(req: IncomingMessage, context: AppContext): http.OutgoingHttpHeaders {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  return corsHeaders(origin, context.config.allowedOrigins);
}

function authenticateAndRateLimit(req: IncomingMessage, context: AppContext): http.OutgoingHttpHeaders {
  const token = requireBearerAuth(req.headers, context.config.apiKeys);
  const result = context.rateLimiter.check(token);
  const headers = rateLimitHeaders(result);
  if (!result.allowed) {
    throw Object.assign(rateLimitError(), { headers });
  }

  return headers;
}

function handleHealth(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res, ['GET', 'HEAD']);
    return;
  }

  const body =
    pathname === '/health/ready'
      ? { status: 'ready', service: SERVICE_NAME, degraded: false }
      : { status: 'ok', service: SERVICE_NAME };

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  sendJson(res, 200, body);
}

export function createRequestHandler(context: AppContext = createDefaultContext()) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const host = req.headers.host ?? '127.0.0.1';
    const requestUrl = new URL(req.url ?? '/', `http://${host}`);

    if (requestUrl.pathname === '/health' || requestUrl.pathname === '/health/live' || requestUrl.pathname === '/health/ready') {
      handleHealth(req, res, requestUrl.pathname);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, requestCorsHeaders(req, context));
      res.end();
      return;
    }

    if (requestUrl.pathname === '/v1/models') {
      void handleModels(req, res, context);
      return;
    }

    if (requestUrl.pathname === '/v1/chat/completions') {
      void handleChatCompletions(req, res, context);
      return;
    }

    sendJson(res, 404, {
      error: {
        message: 'Route not found',
        type: 'invalid_request_error',
        code: 'not_found',
      },
    });
  };
}

async function handleModels(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const baseHeaders = requestCorsHeaders(req, context);
  try {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET']);
      return;
    }

    const rateHeaders = authenticateAndRateLimit(req, context);
    await context.modelRegistry.refresh();
    sendJson(res, 200, context.modelRegistry.toOpenAIResponse(), { ...baseHeaders, ...rateHeaders });
  } catch (error) {
    const extraHeaders = typeof error === 'object' && error !== null && 'headers' in error ? (error.headers as http.OutgoingHttpHeaders) : {};
    sendOpenAIError(res, toServerError(error), { ...baseHeaders, ...extraHeaders });
  }
}

async function handleChatCompletions(req: IncomingMessage, res: ServerResponse, context: AppContext): Promise<void> {
  const baseHeaders = requestCorsHeaders(req, context);
  try {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST']);
      return;
    }

    const rateHeaders = authenticateAndRateLimit(req, context);
    const body = await readJsonBody(req);
    const chatRequest = parseChatCompletionRequest(body);
    await context.modelRegistry.refresh();
    const model = context.modelRegistry.resolveModel(chatRequest.model);

    if (chatRequest.stream === true) {
      await handleStreamingChat(req, res, context, chatRequest, model, { ...baseHeaders, ...rateHeaders });
      return;
    }

    let content = '';

    for await (const event of generateGeminiEvents({
      config: context.config,
      tokenExtractor: context.tokenExtractor,
      request: chatRequest,
      model,
    })) {
      if (event.type === 'error') {
        throw new OpenAIHttpError(502, event.message, 'server_error', event.code);
      }
      content += event.text;
    }

    const created = Math.floor(Date.now() / 1000);
    sendJson(res, 200, {
      id: `chatcmpl-${created}`,
      object: 'chat.completion',
      created,
      model: chatRequest.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    }, { ...baseHeaders, ...rateHeaders });
  } catch (error) {
    const extraHeaders = typeof error === 'object' && error !== null && 'headers' in error ? (error.headers as http.OutgoingHttpHeaders) : {};
    sendOpenAIError(res, toServerError(error), { ...baseHeaders, ...extraHeaders });
  }
}

async function handleStreamingChat(
  req: IncomingMessage,
  res: ServerResponse,
  context: AppContext,
  chatRequest: ReturnType<typeof parseChatCompletionRequest>,
  model: ReturnType<ModelRegistry['resolveModel']>,
  headers: http.OutgoingHttpHeaders,
): Promise<void> {
  const abortController = new AbortController();
  const abortUpstream = (): void => abortController.abort();
  req.once('close', abortUpstream);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...headers,
  });

  const heartbeat = setInterval(() => {
    if (!res.destroyed) {
      res.write(': heartbeat\n\n');
    }
  }, 15_000);

  try {
    const created = Math.floor(Date.now() / 1000);
    for await (const event of generateGeminiEvents({
      config: context.config,
      tokenExtractor: context.tokenExtractor,
      request: chatRequest,
      model,
      signal: abortController.signal,
    })) {
      if (event.type === 'error') {
        await writeSseEvent(res, openAIErrorBody(new OpenAIHttpError(502, event.message, 'server_error', event.code)));
        break;
      }

      await writeSseEvent(res, {
        id: `chatcmpl-${created}`,
        object: 'chat.completion.chunk',
        created,
        model: chatRequest.model,
        choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
      });
    }

    await writeWithBackpressure(res, 'data: [DONE]\n\n');
  } finally {
    clearInterval(heartbeat);
    req.off('close', abortUpstream);
    res.end();
  }
}

export function createServer(context?: AppContext): Server {
  const server = http.createServer(createRequestHandler(context));
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 130_000;
  return server;
}

export function startServer(config: AppConfig = CONFIG): Server {
  const server = createServer(createDefaultContext(config));
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`${SERVICE_NAME} listening on 0.0.0.0:${config.port}\n`);
  });

  const shutdown = (): void => {
    server.close((error) => {
      if (error !== undefined) {
        process.stderr.write(`Failed graceful shutdown: ${error.message}\n`);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return server;
}

const entrypoint = process.argv[1] === undefined ? '' : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entrypoint) {
  startServer();
}
