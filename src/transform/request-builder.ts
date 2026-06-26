import crypto from 'node:crypto';
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

/**
 * Build the inner request array for Gemini's StreamGenerate endpoint.
 * This is a sparse 69-element array where specific indices carry meaning.
 *
 * Reference: https://github.com/HanaokaYuzu/Gemini-API
 */
export function buildGeminiInnerRequest(request: ChatCompletionRequest, uuid: string): readonly unknown[] {
  const normalizedMessages = prependSystemMessages(request.messages);
  const lastUserMessage = normalizedMessages.filter((message) => message.role === 'user').at(-1)?.content ?? '';

  const req: unknown[] = Array.from({ length: 69 }, () => null);

  // [0]: message content [text, 0, null, fileData, null, null, 0]
  req[0] = [lastUserMessage, 0, null, null, null, null, 0];

  // [1]: language
  req[1] = ['en'];

  // [2]: conversation metadata (10-element array)
  req[2] = ['', '', '', null, null, null, null, null, null, ''];

  // [6]: context flags
  req[6] = [1];

  // [7]: streaming flag (always 1 for Gemini; we accumulate on our side)
  req[7] = 1;

  // [10], [11]: processing flags
  req[10] = 1;
  req[11] = 0;

  // [17]: [[0]]
  req[17] = [[0]];

  // [18]: 0
  req[18] = 0;

  // [27]: 1
  req[27] = 1;

  // [30]: [4]
  req[30] = [4];

  // [41]: [1]
  req[41] = [1];

  // [45]: temporary chat flag (1 = stateless, 0 = persistent)
  req[45] = 1;

  // [53]: 0
  req[53] = 0;

  // [59]: UUID (must match x-goog-ext-525005358-jspb header)
  req[59] = uuid;

  // [61]: []
  req[61] = [];

  // [68]: 2 (consolidated response format; 1 = streaming chunks)
  req[68] = 2;

  return req;
}

/**
 * Build the full request body and headers for Gemini's StreamGenerate endpoint.
 *
 * Body format: f.req=[null,"<json_encoded_inner_array>"]&at=<SNlM0e>
 *
 * Headers include:
 * - Standard HTTP headers (Content-Type, Origin, Referer)
 * - X-Same-Domain: 1
 * - Model-specific x-goog-ext-*-jspb headers (model selection)
 * - Request-specific x-goog-ext-525005358-jspb (with matching UUID)
 */
export function buildGeminiRequestBody(
  request: ChatCompletionRequest,
  tokens: GeminiWebTokens,
  model: GeminiModelMapping,
): GeminiWebRequestBuildResult {
  const uuid = crypto.randomUUID().toUpperCase();
  const innerRequest = buildGeminiInnerRequest(request, uuid);

  // f.req = [null, JSON.stringify(inner_request_array)]
  // The outer array wraps the inner JSON string
  const fReq = JSON.stringify([null, JSON.stringify(innerRequest)]);

  const body = new URLSearchParams();
  body.set('f.req', fReq);
  body.set('at', tokens.snlM0e);

  return {
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'X-Same-Domain': '1',
      ...model.modelHeaders,
      'x-goog-ext-525005358-jspb': JSON.stringify([uuid, 1]),
    },
    fReq: innerRequest,
  };
}

/**
 * Build the Gemini StreamGenerate endpoint URL from extracted tokens.
 * The `_reqid` param auto-increments per request.
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
