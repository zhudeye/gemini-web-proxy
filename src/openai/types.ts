import { invalidRequest } from './errors.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly max_tokens?: number;
}

export interface ModelObject {
  readonly id: string;
  readonly object: 'model';
  readonly created: number;
  readonly owned_by: string;
}

export interface ModelListResponse {
  readonly object: 'list';
  readonly data: readonly ModelObject[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRole(value: unknown, index: number): ChatRole {
  if (value === 'system' || value === 'user' || value === 'assistant') {
    return value;
  }

  throw invalidRequest(`messages[${index}].role must be system, user, or assistant`, 'invalid_message_role', `messages.${index}.role`);
}

function parseMessage(value: unknown, index: number): ChatMessage {
  if (!isRecord(value)) {
    throw invalidRequest(`messages[${index}] must be an object`, 'invalid_message', `messages.${index}`);
  }

  const role = parseRole(value['role'], index);
  const content = value['content'];
  if (typeof content !== 'string') {
    throw invalidRequest('Only text message content is supported in v1', 'unsupported_content_type', `messages.${index}.content`);
  }

  if (content.trim().length === 0) {
    throw invalidRequest(`messages[${index}].content must not be empty`, 'empty_message_content', `messages.${index}.content`);
  }

  return { role, content };
}

export function parseChatCompletionRequest(value: unknown): ChatCompletionRequest {
  if (!isRecord(value)) {
    throw invalidRequest('Request body must be a JSON object', 'invalid_request_body');
  }

  const model = value['model'];
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw invalidRequest('model must be a non-empty string', 'invalid_model', 'model');
  }

  const messages = value['messages'];
  if (!Array.isArray(messages) || messages.length === 0) {
    throw invalidRequest('messages must be a non-empty array', 'invalid_messages', 'messages');
  }

  const stream = value['stream'];
  if (stream !== undefined && typeof stream !== 'boolean') {
    throw invalidRequest('stream must be a boolean when provided', 'invalid_stream', 'stream');
  }

  return {
    model: model.trim(),
    messages: messages.map((message, index) => parseMessage(message, index)),
    stream,
    temperature: typeof value['temperature'] === 'number' ? value['temperature'] : undefined,
    max_tokens: typeof value['max_tokens'] === 'number' ? value['max_tokens'] : undefined,
  };
}
