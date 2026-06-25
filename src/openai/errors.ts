export type OpenAIErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'rate_limit_error'
  | 'server_error';

export interface OpenAIErrorBody {
  readonly error: {
    readonly message: string;
    readonly type: OpenAIErrorType;
    readonly param: string | null;
    readonly code: string | null;
  };
}

export class OpenAIHttpError extends Error {
  readonly statusCode: number;
  readonly type: OpenAIErrorType;
  readonly param: string | null;
  readonly code: string | null;

  constructor(statusCode: number, message: string, type: OpenAIErrorType, code: string | null = null, param: string | null = null) {
    super(message);
    this.name = 'OpenAIHttpError';
    this.statusCode = statusCode;
    this.type = type;
    this.param = param;
    this.code = code;
  }
}

export function openAIErrorBody(error: OpenAIHttpError): OpenAIErrorBody {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
    },
  };
}

export function invalidRequest(message: string, code: string, param: string | null = null): OpenAIHttpError {
  return new OpenAIHttpError(400, message, 'invalid_request_error', code, param);
}

export function authenticationError(message = 'Invalid bearer token'): OpenAIHttpError {
  return new OpenAIHttpError(401, message, 'authentication_error', 'invalid_api_key');
}

export function rateLimitError(message = 'Rate limit exceeded'): OpenAIHttpError {
  return new OpenAIHttpError(429, message, 'rate_limit_error', 'rate_limit_exceeded');
}
