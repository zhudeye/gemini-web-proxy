import type { GeminiWebTokens } from '../auth/token-extractor.js';
import type { GeminiModelMapping } from '../models/registry.js';
import type { ChatCompletionRequest, ChatMessage } from '../openai/types.js';

export interface GeminiWebRequestBuildResult {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fReq: readonly unknown[];
}

const SYSTEM_DELIMITER = 'System instructions:';

function prependSystemMessages(messages: readonly ChatMessage[]): readonly ChatMessage[] {
  const systemContent = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');
  const nonSystemMessages = messages.filter((message) => message.role !== 'system');

  if (systemContent.length === 0) {
    return nonSystemMessages;
  }

  const firstUserIndex = nonSystemMessages.findIndex((message) => message.role === 'user');
  const prefixedContent = `${SYSTEM_DELIMITER}\n${systemContent}`;

  if (firstUserIndex === -1) {
    return [{ role: 'user', content: prefixedContent }, ...nonSystemMessages];
  }

  return nonSystemMessages.map((message, index) => {
    if (index !== firstUserIndex) {
      return message;
    }

    return {
      role: 'user',
      content: `${prefixedContent}\n\nUser message:\n${message.content}`,
    };
  });
}

function toGeminiTurns(messages: readonly ChatMessage[]): readonly unknown[] {
  return messages.map((message) => [message.role, message.content]);
}

export function buildGeminiFReq(request: ChatCompletionRequest, model: GeminiModelMapping): readonly unknown[] {
  const normalizedMessages = prependSystemMessages(request.messages);
  const sparseRequest: unknown[] = Array.from({ length: 46 }, () => null);

  sparseRequest[0] = toGeminiTurns(normalizedMessages);
  sparseRequest[1] = model.upstreamModelId;
  sparseRequest[7] = request.stream === true ? 1 : 0;
  sparseRequest[8] = typeof request.temperature === 'number' ? request.temperature : null;
  sparseRequest[9] = typeof request.max_tokens === 'number' ? request.max_tokens : null;
  sparseRequest[45] = 1;

  return sparseRequest;
}

export function buildGeminiRequestBody(
  request: ChatCompletionRequest,
  tokens: GeminiWebTokens,
  model: GeminiModelMapping,
): GeminiWebRequestBuildResult {
  const fReq = buildGeminiFReq(request, model);
  const body = new URLSearchParams();
  body.set('f.req', JSON.stringify([fReq]));
  body.set('at', tokens.snlM0e);

  return {
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'x-goog-ext-525001261-jspb': JSON.stringify([model.upstreamModelId]),
    },
    fReq,
  };
}

/**
 * Build the Gemini Web StreamGenerate endpoint URL from extracted tokens.
 * The `_reqid` param auto-increments per request to satisfy Google's batching protocol.
 */
let nextReqId = Math.floor(Math.random() * 100000) + 100000;

export function buildGeminiEndpointUrl(tokens: GeminiWebTokens, lang = 'en'): string {
  const reqId = nextReqId;
  nextReqId += 100000;

  const url = new URL('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate');
  url.searchParams.set('bl', tokens.cfb2h);
  url.searchParams.set('f.sid', tokens.fdrFJe);
  url.searchParams.set('hl', lang);
  url.searchParams.set('_reqid', String(reqId));
  url.searchParams.set('rt', 'c');

  return url.toString();
}
