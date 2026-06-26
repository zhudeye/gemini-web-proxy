# Gemini Web Proxy — Development Guide

## 1. Architecture Overview

```
Client (OpenAI SDK/curl / Cherry Studio)
  │  POST /v1/chat/completions
  │  GET /v1/models
  ▼
HTTP Server (src/server.ts) — plain node:http
  │  authenticate → rate-limit → guard (concurrency/delay/quota)
  │  modelRegistry.refresh() — returns BUILTIN_MODELS (4 hardcoded models)
  ▼
ModelRegistry (src/models/registry.ts)
  │  4 built-in models with hardcoded hex IDs:
  │    gemini-3.5-flash     56fdd199312815e2  (flash,  standard)
  │    gemini-3.5-thinking  56fdd199312815e2  (flash,  extended thinking)
  │    gemini-3.1-pro       e6fa609c3fa255c0  (pro,    standard)
  │    gemini-3.1-flash-lite 8c46e95b1a07cecc (flash-lite, standard)
  │  No homepage scraping — hex IDs are compiled in.
  ▼
GeminiTokenExtractor (src/auth/token-extractor.ts)
  │  fetches gemini.google.com/app HTML
  │  extracts SNlM0e, cfb2h, FdrFJe tokens (for auth, NOT for model discovery)
  ▼
request-builder (src/transform/request-builder.ts)
  │  builds StreamGenerate URL + POST body
  │  maps OpenAI messages → Gemini sparse-array format
  │  attaches model-specific headers from ModelRegistry
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
| `src/models/registry.ts` | Model registry with 4 built-in models (`gemini-3.5-flash`, `gemini-3.5-thinking`, `gemini-3.1-pro`, `gemini-3.1-flash-lite`). Each model has a hardcoded hex ID, capacity tier, and thinking level. `ModelRegistry.refresh()` returns built-in models immediately without scraping the Gemini homepage. `resolveModel()` maps OpenAI model names to `GeminiModelMapping` (containing `modelHeaders` for the StreamGenerate endpoint). |
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
| `PORT` | no | `8080` | HTTP listen port. Render injects this automatically. |
| `GEMINI_COOKIE` | yes | mock value (dev) | Combined cookie string: `__Secure-1PSID=x; __Secure-1PSIDTS=y; __Secure-1PSIDCC=z`. Paste the full cookie string from DevTools — extra cookies are ignored. |
| `API_KEYS` | yes | `test-key` (dev) | Comma-separated Bearer API keys |
| `ALLOWED_ORIGINS` | no | `http://localhost:3000, http://127.0.0.1:3000` | CORS allowlist |
| `RATE_LIMIT_PER_MINUTE` | no | `20` | Max requests per API key per minute |
| `MAX_CONCURRENT_REQUESTS` | no | `2` | Max concurrent requests per API key |
| `MIN_REQUEST_DELAY_MS` | no | `1500` | Minimum interval (ms) between requests per key |
| `DAILY_QUOTA` | no | `500` | Max requests per API key per day |
| `GEMINI_ENDPOINT` | no | auto-discovered | Override the StreamGenerate endpoint URL |
| `GEMINI_PROXY` | no | none | HTTP proxy URL for upstream Gemini requests. Do **not** set in production (Render). |
| `GEMINI_DUMP` | no | none | Directory path for raw response dumps. Dev-only. |

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

**Key test file: `tests/model-registry.test.ts`**

Tests the 4 built-in models, model resolution, `createModelMapping` helper, and `toOpenAIResponse` serialization. No homepage fetch required — models are hardcoded.

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

7. **`ERR_HTTP_HEADERS_SENT` crash** — The streaming path writes HTTP 200 headers immediately, then generates Gemini events. If token extraction or the upstream request fails after headers are sent, the catch block in `handleChatCompletions` must check `res.headersSent` before calling `sendOpenAIError()`. Without this guard, Node.js throws `ERR_HTTP_HEADERS_SENT` and the process exits. Fixed in `src/server.ts`:
   ```typescript
   } catch (error) {
     if (res.headersSent) {
       if (!res.writableEnded) res.end();
       return;
     }
     sendOpenAIError(res, toServerError(error), { ... });
   }
   ```

8. **`stop.cmd` not working on Windows** — The original script used `tokens=1` on `netstat -ano` output, which captured the protocol name (`TCP`) instead of the PID (5th column). Fixed by using `tokens=5` and removing the redundant outer `tasklist` loop.

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

**Windows quick scripts:**

```batch
start.cmd    :: Reads .env, starts node dist/server.js in background
stop.cmd     :: Finds and kills the process on port 8080
```

The build output goes to `dist/server.js`. The entry module detects whether it is the main module (`import.meta.url === entrypoint`) and calls `startServer()` automatically.

## 9. Deploying to Render

### Prerequisites

- Push the repository to GitHub (`.env` is gitignored — safe)
- Render account connected to the GitHub repo

### Via Blueprint (render.yaml)

The included `render.yaml` defines:

```yaml
services:
  - type: web
    name: gemini-web-proxy
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: RATE_LIMIT_PER_MINUTE
        value: "20"
      - key: GEMINI_COOKIE          # sync: false → set in Dashboard
        sync: false
      - key: API_KEYS               # sync: false → set in Dashboard
        sync: false
      - key: ALLOWED_ORIGINS
        sync: false
```

In Render Dashboard: **New Blueprint** → select repo → `render.yaml` is auto-detected.

### Manual Web Service Creation

| Setting | Value |
|---|---|
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

### Required Environment Variables (set in Dashboard)

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Pre-set in render.yaml |
| `GEMINI_COOKIE` | Full cookie string from DevTools | Paste everything — parser auto-extracts `__Secure-1PSID`, `__Secure-1PSIDTS`, `__Secure-1PSIDCC` |
| `API_KEYS` | `key1,key2` | Comma-separated Bearer tokens |

### Do NOT Set in Production

- `GEMINI_PROXY` — local proxy only (Clash etc.)
- `GEMINI_DUMP` — dev debugging only
- `PORT` — Render injects this automatically

### Keeping Render Awake

Render Free Web Services spin down after ~15 minutes of inactivity. Cold start takes ~30–60 seconds. To reduce sleep:

- **UptimeRobot** — free HTTP monitor pinging `/health` every 10 minutes
- Render's **Starter** plan ($7/mo) — no spin-down

### Re-deploying After Changes

1. Push to GitHub (`git push origin main`)
2. Render Dashboard → Manual Deploy → **Deploy with latest build**

Or enable **Auto-Deploy** in Render Dashboard → Settings → Deploy hooks.

### Troubleshooting Render Deployment

| Symptom | Likely cause |
|---|---|
| Health check passes, `/v1/models` returns 401 with valid key | Cold start — wait 30s and retry |
| `/v1/chat/completions` returns `502` with Gemini upstream error | Cookie expired — re-extract from DevTools and update `GEMINI_COOKIE` |
| `ERR_HTTP_HEADERS_SENT` in logs | Old build without the fix (`3854d1b`). Re-deploy with latest commit. |
| Server crashes on startup | Missing `GEMINI_COOKIE` or `API_KEYS` — check Dashboard env vars |
