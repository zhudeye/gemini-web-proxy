# Decisions — geminiweb-render-api-proxy

> Architectural choices, defaults, and rationale.

## Technology Stack
- **Runtime**: Node.js 20+ (native `node:http`, no Express/Fastify)
- **Language**: TypeScript (strict mode)
- **Build**: esbuild for production, tsx for dev
- **Test**: Vitest (tests-after)
- **Deploy**: Render Free Web Service

## Protocol Decisions
- Token extraction: auto at startup from Cookie env vars → `gemini.google.com/app`
- Cookie refresh: manual only (no RotateCookies in v1)
- System messages: prepend to first user message with delimiter
- Expired cookies: retry token extraction once, then 502
- Unknown model: 400 `model_not_supported`
