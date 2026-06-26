# Gemini Web Proxy — Development Guide

## 1. Architecture Overview

```
Client (OpenAI SDK/curl)
  │  POST /v1/chat/completions
  │  GET /v1/models
  ▼
Express Server (src/server.ts)
  │  authenticate → rate-limit → parse request
  │  read cookie from GEMINI_COOKIE env
  ▼
GeminiTokenExtractor (src/auth/token-extractor.ts)
  │  fetches gemini.google.com/app HTML
  │  extracts SNlM0e, cfb2h, FdrFJe tokens
  ▼
request-builder (src/transform/request-builder.ts)
  │  builds StreamGenerate URL + POST body
  │  maps OpenAI messages → Gemini sparse-array format
  ▼
upstream.ts (src/gemini/upstream.ts)
  │  HTTP POST to gemini.google.com StreamGenerate endpoint
  │  optional ProxyAgent via GEMINI_PROXY
  ▼
GeminiFrameParser (src/transform/frame-parser.ts)
  │  parses SSE-length-prefixed JSON frames
  │  extracts text deltas, strips encrypted context
  ▼
SSE stream (text/event-stream)
  │  data: {"choices":[{"delta":{"content":"..."}}]}
  └─ or aggregated JSON response for non-streaming
```

The proxy exposes three HTTP routes:
- `POST /v1/chat/completions` — OpenAI-compatible chat completion (streaming and non-streaming)
- `GET /v1/models` — lists available Gemini models
- `GET /health`, `/health/live`, `/health/ready` — health checks

All `/v1/*` routes require `Authorization: Bearer <key>` where the key is in the `API_KEYS` env var.

## 2. File Map

| File | Purpose |
|---|---|
| `src/server.ts` | Express-style HTTP server (plain `node:http`). Routes: `/v1/chat/completions`, `/v1/models`, `/health`. Wires auth, CORS, rate limiting, and the upstream Gemini pipeline. |
| `src/transform/frame-parser.ts` | Core Gemini Web SSE frame parser. Handles the StreamGenerate wire format: length-prefixed JSON lines, batch wrapper unwrapping, candidate text extraction, encrypted suffix stripping, metadata frame rejection. Most complex module in the codebase. |
| `src/gemini/upstream.ts` | HTTP client to `gemini.google.com`. Manages ProxyAgent lifecycle, reads the streaming response body, feeds chunks into `GeminiFrameParser`, and optionally dumps raw bytes to disk. |
| `src/auth/token-extractor.ts` | Cookie-to-endpoint auto-discovery. Fetches `gemini.google.com/app` HTML, regex-extracts `SNlM0e`, `cfb2h`, and `FdrFJe` tokens used for authentication and URL construction. |
| `src/transform/request-builder.ts` | Converts OpenAI `ChatCompletionRequest` into Gemini's StreamGenerate POST body. Builds the sparse 69-element inner request array, the `f.req` URL-encoded body, and model-specific headers. |
| `src/config.ts` | Reads and validates all environment variables (`GEMINI_COOKIE`, `GEMINI_PROXY`, `API_KEYS`, `PORT`, etc.). Provides a typed `AppConfig` interface and a `loadConfig()` factory. |
| `src/http/json-body.ts` | Utility to read and parse `req` body as JSON with size limits. |
| `src/models/registry.ts` | Model registry: resolves model names to Gemini model mappings (headers + endpoint config). |
| `src/openai/types.ts` | OpenAI-compatible TypeScript types (`ChatCompletionRequest`, `ChatMessage`, etc.) and a parser/validator (`parseChatCompletionRequest`). |
| `src/openai/errors.ts` | OpenAI-formatted error body builders. |
| `src/security/auth.ts` | Bearer token extraction and validation against configured `API_KEYS`. |
| `src/security/rate-limit.ts` | Sliding-window rate limiter per API key. |
| `src/security/cors.ts` | CORS header generation from `ALLOWED_ORIGINS` whitelist. |
| `src/security/redaction.ts` | Redacts secrets from error messages before sending them over the wire. |
| `tests/frame-parser.test.ts` | Frame parser unit tests: chunk boundary robustness, batch wrappers, metadata frame rejection, encrypted suffix stripping, error sequences. |
| `.env` / `.env.example` | Environment variable templates. `.env` is gitignored. |
| `.gitignore` | Excludes `node_modules/`, `dist/`, `.env`, `dumps/`, `*.log`, `.sisyphus/evidence/`. |

## 3. Gemini Web Protocol Internals

This section documents the real wire format of Google's internal StreamGenerate RPC, reverse-engineered from the Gemini Web client. Understanding this is essential for maintaining the frame parser.

### 3.1 SSE Frame Format

The Gemini StreamGenerate endpoint returns an HTTP streaming response where each line is a JSON array prefixed by its byte length on the preceding line.

**Wire representation:**

```
)]}'                                         ← anti-XSSI prefix (first line only)
1253                                          ← byte length of the next JSON line
["wrb.fr",null,"[null,[\"c_...\",\"r_...\"]]"] ← outer frame
298
["wrb.fr",null,"[null,[\"c_...\",\"r_...\"]]"]
...
```

**Outer frame structure:**

The outer array follows Google's `wrb.fr` (WebResponseBatch.Frame) format:

```json
["wrb.fr", null, "<json-stringified-payload>"]
```

In some responses, frames arrive wrapped in an extra batch array:

```json
[["wrb.fr", null, "<json-stringified-payload>"]]
```

The parser handles both via the unwrap logic at line 221 of `frame-parser.ts`:

```typescript
const frames = isRecordArray(outer[0]) ? outer : [outer];
```

**Inner payload (parsed from the stringified third element):**

```json
[null, ["c_a9ae8c61a13c9db3", "r_88798db14c2d9b3d"], null, null, [[candidate_id, [text_parts, ...], ...]], ...]
```

Position | Field | Description
---|---|---
`[0]` | `null` | Reserved
`[1]` | `["c_<convHex>", "r_<reqHex>"]` | Conversation ID and request ID
`[2]` | `null` | Reserved
`[3]` | `null` | Reserved
`[4]` | `[[candidate_id, [text_parts], ...]]` | Candidate array with text parts
`[5+]` | varies | Additional metadata (often absent or null)

### 3.2 Text Extraction

`extractStreamGenerateText()` at line 126 of `frame-parser.ts` extracts response text from a parsed inner payload.

**Guard conditions:**
- `parsedPayload` must be an array with `length >= 5`
- `parsedPayload[4]` must be a non-empty array (the candidates slot)

**Text location:**

For each candidate, the response text lives at `candidate[1][0]` — the first element of the text parts array:

```
payload[4] → [[candidate_id, [text_parts, ...]], ...]
                   ^^^^^^^^^  ^^^^^^^^^^^^^
                   [0]         [1]
                               [1][0] = first text part (actual response text)
                               [1][1] = encrypted context blob (NOT response text)
                               [1][2+] = more context blobs
```

Only `candidate[1][0]` is used. Subsequent text parts contain encrypted context data, not user-visible response text.

### 3.3 Encrypted Context Stripping

Gemini appends encrypted metadata to the end of the response text in this pattern:

```
<response text>c_<convHex><base64data>c_<convHex>
```

For example, with `convId = "c_a9ae8c61a13c9db3"`:

```
Hello worldc_a9ae8c61a13c9db3AwAAAAAAAAAQwBHO-LzoF6L9DAwh8Bkc_a9ae8c61a13c9db3
```

The stripping logic (lines 137-173 of `frame-parser.ts`):

1. Extract conversation hex from `payload[1][0]` by removing the `c_` prefix (e.g., `"c_a9ae8c61a13c9db3"` → `"a9ae8c61a13c9db3"`)
2. Build a regex using the conversation hex as anchor: `c_<escaped-hex>.*$`
3. Apply a generic fallback regex `/c_[0-9a-f]{16}.*$/g` for cases where the conversation ID is unavailable

The conversation-ID-anchored regex is preferred because it avoids false positives on legitimate text containing `c_<16hex>` patterns.

### 3.4 Metadata Frames (Bug we fixed)

Gemini interleaves metadata frames with text frames. These frames look like:

```json
[null, ["c_08027..."], {"key": "val"}, null]
```

Or as a non-array object:

```json
{"some": "metadata", "response": "data"}
```

**The bug:** Without proper guards, the `findLongestString()` fallback (lines 30-58) recursively scans the entire payload tree and returns the longest string. Metadata frames contain long conversation IDs (`c_...`, typically ~20 chars) or base64 prefixes that are longer than the actual response text. This caused garbled metadata to leak into the output.

**The fix:**

`processFrame()` at line 230 applies three guards in sequence:

1. **`!Array.isArray(inner)` guard** (line 273): Object metadata frames are skipped entirely.
2. **`inner.length < 5` guard** (line 273): Short array frames (length 4, the metadata frame pattern) never reach `findLongestString()`.
3. **`inner[4]` content checks** (lines 246-265): Even for length >= 5 frames, if `inner[4]` is null, undefined, empty array, or a non-array (e.g. metadata object), the frame is skipped instead of falling through to `findLongestString()`.

Only after all StreamGenerate-specific checks fail does the code fall back to `findLongestString()` for legacy batchexecute format compatibility.

### 3.5 Frame Type Matrix

| Frame length | `payload[4]` content | Interpretation | Action |
|---|---|---|---|
| length >= 5, `payload[4]` is nested array | `[[candidate, [text, ...]]]` | StreamGenerate text | Extract `candidate[1][0]`, strip encrypted suffix, emit delta |
| length >= 5, `payload[4]` is null | `null` | Awaiting response | Skip |
| length >= 5, `payload[4]` is empty array | `[]` | No candidates yet | Skip |
| length >= 5, `payload[4]` is non-array object | `{...}` | Metadata object | Skip (`inner[4]` non-array guard at line 264) |
| length < 5 (e.g. 4) | N/A | Metadata frame (conversation metadata, encryption keys) | Skip (`inner.length < 5` guard) |
| Not an array | N/A | Object metadata | Skip (`!Array.isArray` guard at line 273) |
| Contains `[5,2,0,1,0]` anywhere | N/A | Upstream error (quota, auth failure) | Emit `{type:'error', code:'1037'}` event |

## 4. Proxy Setup

The `GEMINI_PROXY` environment variable routes all Gemini upstream requests through an HTTP proxy.

**Implementation** (`src/gemini/upstream.ts`, line 40-52):

```typescript
const proxyAgent = new ProxyAgent(options.config.geminiProxy);
response = await undiciFetch(endpointUrl, {
  method: 'POST',
  headers: geminiRequest.headers,
  body: geminiRequest.body,
  signal: options.signal,
  dispatcher: proxyAgent,
});
```

**Why `--external:undici` is required:** The `undici` package uses dynamic `require()` calls internally, which are incompatible with esbuild's default ESM bundling. The `--external:undici` flag (in `package.json` build script) prevents esbuild from inlining undici, keeping it as an external dependency loaded at runtime.

**Standard proxy values:**
- `http://127.0.0.1:7890` — Clash Verge / general proxy tools
- `http://127.0.0.1:10809` — SOCKS-to-HTTP conversion tools

The same proxy mechanism is also available for the token extraction page fetch via `createProxyAwareFetch()` in `src/server.ts` (line 26-29), which creates a `ProxyAgent` and passes it as `dispatcher` to `undici.fetch`.

## 5. Debugging

### 5.1 Dump Mode

Set `GEMINI_DUMP=dumps` to write raw Gemini SSE response bytes to disk before any parsing:

```
set GEMINI_DUMP=dumps
```

Each request produces a file at `dumps/gemini-raw-<timestamp>.txt` containing the exact bytes received from `gemini.google.com`, including the `)]}'` prefix, length lines, and all raw frames.

**Use cases:**
- Inspecting new or changed frame formats that the parser doesn't handle
- Comparing dump output between working and broken requests
- Feeding dump data into `parseGeminiFrameStream()` for offline debugging
- Verifying that upstream changes haven't altered the wire format

The dump is written unconditionally after the response body is consumed (`src/gemini/upstream.ts`, lines 105-118). The `dumps/` directory is in `.gitignore`.

### 5.2 Mock Mode

In non-production mode (`NODE_ENV !== 'production'`) with no `GEMINI_ENDPOINT` set, `upstream.ts` returns a mock response instead of contacting Gemini. This allows tests and local development to run without real cookies.

### 5.3 Environment Variables

| Variable | Required in production | Default | Description |
|---|---|---|---|
| `NODE_ENV` | yes | `development` | `production` enables strict validation and disables mock mode |
| `PORT` | no | `8080` | HTTP listen port |
| `GEMINI_COOKIE` | yes | mock value (dev) | Combined cookie string: `__Secure-1PSID=x; __Secure-1PSIDTS=y; __Secure-1PSIDCC=z` |
| `API_KEYS` | yes | `test-key` (dev) | Comma-separated Bearer API keys |
| `ALLOWED_ORIGINS` | no | `http://localhost:3000, http://127.0.0.1:3000` | CORS allowlist |
| `RATE_LIMIT_PER_MINUTE` | no | `20` | Max requests per API key per minute |
| `GEMINI_ENDPOINT` | no | auto-discovered | Override the StreamGenerate endpoint URL |
| `GEMINI_PROXY` | no | none | HTTP proxy URL for upstream Gemini requests |
| `GEMINI_DUMP` | no | none | Directory path for raw response dumps |

## 6. Testing

**Run command:**
```
npm test
```

Tests use **vitest** and are located in `tests/`. They run in non-production mode automatically (mock Gemini response, no real cookies needed).

**Key test file: `tests/frame-parser.test.ts`**

The `wrbFrame()` helper constructs realistic Gemini frames:

```typescript
function wrbFrame(fullText: string): string {
  const payload = JSON.stringify([null, ['c_id', 'r_id'], null, null, [['rc_id', [fullText]]]]);
  return JSON.stringify(['wrb.fr', null, payload]);
}
```

**Test coverage includes:**

- **Chunk boundary robustness** — feeds the same stream at sizes 1, 2, 5, 10, 100, 200 and verifies identical output
- **Batch wrapper format** — tests the `[["wrb.fr", null, payload]]` nested array format
- **Metadata frame rejection** — verifies that length-4 frames, null candidates, empty candidates, and non-array object frames produce no events
- **Encrypted suffix stripping** — verifies `Helloc_a9ae8c61a13c9db3...` strips to `Hello`
- **Error sequence detection** — verifies `[5,2,0,1,0]` maps to an error event
- **Malformed JSON** — verifies `FrameParseError` is thrown

**Running specific tests:**
```
npx vitest run tests/frame-parser.test.ts
npx vitest --watch   # watch mode
```

## 7. Common Pitfalls

1. **Forgetting `--external:undici`** — esbuild's ESM build will fail with a `require is not defined` error. The flag must be present in the build command. If you add another CJS-incompatible dependency, externalize it the same way.

2. **New metadata frame formats** — Gemini adds new frame types periodically. If text output suddenly goes wrong, enable dump mode (`GEMINI_DUMP=dumps`) and inspect the raw frames. Common changes include new array positions, new object-shaped metadata, or additional nested levels.

3. **Cookie expiry** — `__Secure-1PSID*` tokens expire after an indeterminate period (hours to days depending on Google's session policy). The proxy cannot auto-rotate cookies. Renew them manually by re-extracting from the browser DevTools. Symptoms: HTTP 401/403 from the upstream or an error event with code `1037`.

4. **Encoding issues with `curl` on Windows PowerShell** — PowerShell's `curl` alias maps to `Invoke-WebRequest`, which has different semantics. Use one of these approaches:

   **Option A: `node -e` with `Buffer.byteLength`**
   ```powershell
   node -e "const http = require('http'); const data = JSON.stringify({model:'gemini-web',messages:[{role:'user',content:'hello'}],stream:true}); const req = http.request('http://localhost:8080/v1/chat/completions', {method:'POST',headers:{'Authorization':'Bearer test-key','Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}}, (res) => { res.on('data', (c) => process.stdout.write(c.toString())); }); req.write(data); req.end();"
   ```

   **Option B: `Invoke-RestMethod` with `ConvertTo-Json`**
   ```powershell
   $body = @{model="gemini-web"; messages=@(@{role="user"; content="hello"})} | ConvertTo-Json
   Invoke-RestMethod -Uri http://localhost:8080/v1/chat/completions -Method POST -Headers @{Authorization="Bearer test-key"} -Body $body -ContentType "application/json"
   ```

5. **ProxyAgent not closing** — Each request creates a new `ProxyAgent` instance. If you see socket exhaustion, verify that the `finally` block in `upstream.ts` line 50-52 is calling `proxyAgent.close()`. For high-throughput deployments, consider hoisting the agent to a singleton.

6. **`text/event-stream` buffering by reverse proxies** — Nginx, Cloudflare, and Render's proxy may buffer SSE output. The `X-Accel-Buffering: no` header helps with nginx. If streaming appears to hang, check whether intermediate proxies are buffering the response.

## 8. Build & Run Commands

```bash
# Install dependencies
npm ci

# Production build (esbuild bundle to dist/)
npm run build

# Run tests
npm test

# Watch mode for tests
npm run test:watch

# Start production server (requires dist/ built)
npm start

# Local dev with hot-reload
npm run dev
```

**Local development with proxy and debugging:**

```powershell
set GEMINI_COOKIE="__Secure-1PSID=xxx; __Secure-1PSIDTS=yyy; __Secure-1PSIDCC=zzz"
set GEMINI_PROXY=http://127.0.0.1:7890
set GEMINI_DUMP=dumps
set API_KEYS=dev-key
set NODE_ENV=development
npm run dev
```

**Production start (Render / bare metal):**

```bash
npm ci && npm run build && npm start
```

The build output goes to `dist/server.js`. The entry module detects whether it is the main module (`import.meta.url === entrypoint`) and calls `startServer()` automatically.
