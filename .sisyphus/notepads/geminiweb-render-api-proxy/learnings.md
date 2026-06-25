# Learnings — geminiweb-render-api-proxy

> Conventions, patterns, gotchas discovered during implementation.

## Session: ses_10232146cffebTMu1EIET5ddD6 (2026-06-25)

### Startup
- Greenfield project at `C:\Users\27826\Desktop\gemini-web`
- No `.git` repo yet (needs `git init` before Render deploy)
- No `package.json`, no source files
- Plan verified by Metis (gap analysis) and Momus (OKAY)
- User confirmed all critical decisions

### T1 Scaffold Verification
- Project scaffold uses ESM package with Node 20+, `tsx`, `esbuild`, `vitest`, and strict TypeScript.
- TypeScript LSP server is not installed globally; verified via `npx tsc --noEmit` instead of LSP diagnostics.
- `/health` currently returns stub JSON for all paths; route-specific 404/405 is deferred to T3.
- Secret scan for T1 must exclude `.sisyphus/` because plan text intentionally mentions token names like `SNlM0e`.

### T2 Config/Redaction
- `loadConfig(env)` is testable and production-strict; non-production uses mock defaults so Vitest can run without real Gemini secrets.
- `CONFIG`/`PORT` exports preserve compatibility with the T1 server stub while still failing fast in production if required env vars are absent.
- Redaction must apply known-secret replacement before generic bearer/header/query redaction.
- Regex callbacks with optional capture groups can mis-handle offsets; explicit replacement chains are safer for redaction.

### T3 Native Server
- `src/server.ts` now exports `createRequestHandler`, `createServer`, and `startServer` so tests can exercise native HTTP routes without binding the production port.
- Entry point detection uses `import.meta.url === pathToFileURL(process.argv[1]).href` to avoid starting the server during tests.
- PowerShell 5.1 lacks `Invoke-WebRequest -SkipHttpErrorCheck`; use `curl.exe -s -i` for evidence involving expected 4xx responses.

### T4 OpenAI/Security Primitives
- `OpenAIHttpError` is the shared error contract for OpenAI-style JSON errors.
- `parseChatCompletionRequest()` rejects non-string message content so images/tools cannot silently pass through v1.
- `SlidingWindowRateLimiter` is an in-memory primitive; multi-instance Render scaling would require external state, but v1 targets Free Web Service single instance.
- `corsHeaders()` intentionally omits `Access-Control-Allow-Origin` for blocked origins rather than throwing; route integration can decide final response behavior.

### T5 Token Extraction
- `GeminiTokenExtractor` uses fetch injection for tests and caches extracted tokens in memory only.
- Token extraction currently supports JSON object and tuple-like HTML snippets for `SNlM0e`, `cfb2h`, and `FdrFJe`.
- Cookie header builder maps env values to `__Secure-1PSID`, `__Secure-1PSIDTS`, and optional `__Secure-1PSIDCC`.
- No `RotateCookies` support was added, matching v1 scope.

### T6 Model Registry
- Model discovery is represented as an injectable async function; no live Gemini probing is hardcoded yet.
- Fallback model is `gemini-web`, marked degraded with reason so `/health/ready` can later expose degraded status.
- Unknown client model names throw `OpenAIHttpError` 400 `model_not_supported`, matching the resolved critical decision.

### T7 Request Builder
- `buildGeminiRequestBody()` returns both URL-encoded body and raw `fReq` for tests/debugging without exposing this to clients.
- System messages are prepended into the first user message with `System instructions:` and `User message:` delimiters.
- Temporary-chat flag is represented at `fReq[45] = 1`; stream flag at `fReq[7]`.

### T8 Frame Parser
- `GeminiFrameParser` handles incremental chunks, XSSI prefix, numeric length lines, non-`wrb.fr` frames, nested JSON payloads, and cumulative text diffs.
- Known upstream error sequence `[5,2,0,1,0]` must be checked after parsing the nested payload, not only on the outer frame.
- Test fixture confirms stable output across 1/2/5/10/100/200-byte chunks.

### T9 Non-streaming Route
- Server now has `/v1/models` and non-streaming `/v1/chat/completions` wiring with bearer auth, JSON body parsing, model resolution, mocked upstream default, and OpenAI-compatible response shape.
- `sendJson()` accepts `unknown` bodies because specific response interfaces like `ModelListResponse` do not have index signatures.
- Mock upstream activates for default non-production endpoint `/_/mock/endpoint`, enabling tests without real Gemini cookies.

### T10 Streaming Route
- Streaming route emits OpenAI-style `chat.completion.chunk` SSE events and terminates with exact `data: [DONE]`.
- Response headers include `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`, and no `Content-Length`.
- Streaming uses `writeWithBackpressure()` and aborts upstream work through `AbortController` when the request closes.

### T11 Security Integration
- `/v1/*` routes now combine bearer auth, CORS headers, and in-memory per-key rate limiting.
- Rate-limit errors carry headers through an attached `headers` property and are serialized as OpenAI-style 429 errors.
- Blocked CORS origins get `Vary: Origin` but no permissive `Access-Control-Allow-Origin`.

### T12 Docs/Deployment
- `render.yaml` targets Render Free Web Service with `npm ci && npm run build`, `npm start`, `/health`, and `sync: false` secret env vars.
- `.env.example` uses placeholders only; `.gitignore` excludes `.env*` while allowing `.env.example`.
- README documents DevTools cookie/endpoint capture, OpenAI-compatible curl examples, Render Free limitations, and scope exclusions.

### T13 Full Contract Suite
- Full suite currently has 13 test files and 37 tests passing offline.
- `tests/edge-coverage.test.ts` tracks E1-E37 explicitly; many entries map to existing focused tests and docs.
- `npx tsc --noEmit` remains the TypeScript diagnostic substitute because global TypeScript LSP server is unavailable.

### T14 Local Mock E2E
- `docs/local-runbook.md` records local mock-mode startup and curl verification commands.
- PowerShell curl evidence uses `curl.exe` to avoid alias behavior.
- Local E2E covers `/health`, authorized `/v1/models`, unauthorized `/v1/models`, non-streaming chat, and streaming SSE with `[DONE]`.
