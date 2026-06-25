# Gemini Web Render API Proxy Plan

## TL;DR

> **Quick Summary**: Build a greenfield Node.js + TypeScript service for Render Free Web Service that converts OpenAI-compatible chat requests into Gemini Web private protocol calls, then converts Gemini Web responses back into OpenAI-compatible JSON/SSE responses.
>
> **Deliverables**:
> - OpenAI-compatible `POST /v1/chat/completions` with streaming and non-streaming support
> - OpenAI-compatible `GET /v1/models` with best-effort model discovery and fallback alias
> - Bearer API key auth, CORS allowlist, request size limit, rate limiting, redacted logging
> - Gemini Web token extraction from environment-provided cookies/endpoint
> - Gemini Web proprietary frame parser and OpenAI protocol transformer
> - Vitest test suite, README, `.env.example`, `.gitignore`, `render.yaml`, Render deployment verification steps
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 implementation waves + final verification wave
> **Critical Path**: T1 â†?T5 â†?T7/T8 â†?T9/T10 â†?T12 â†?Final Verification

---

## Resolved Critical Decisions

Metis identified Gemini Web private-protocol questions. User resolved them as follows:

- **Token extraction source**: service starts with Cookie env vars and automatically extracts `SNlM0e`, `cfb2h`, and `FdrFJe` from `gemini.google.com/app`. No manual token override in v1.
- **Cookie refresh**: v1 uses manual cookie rotation only. Do not implement `RotateCookies` background refresh.
- **System message mapping**: prepend OpenAI `role: "system"` content to the first user message with a clear delimiter.
- **Expired cookies**: retry token extraction once; if still invalid, return OpenAI-compatible 502 error with code `gemini_auth_expired`.
- **Unknown model**: return OpenAI-compatible 400 error with code `model_not_supported`; do not silently map `gpt-*` or unknown names to Gemini.

---

## Context

### Original Request
User wants a project deployable on Render that reverse-proxies Gemini Web-side conversation capability and wraps it as an API for external calls. User requested detailed questioning before planning.

### Interview Summary
**Confirmed choices**:
- API shape: OpenAI-compatible.
- Endpoints: `POST /v1/chat/completions`, `GET /v1/models`, health endpoints.
- Response mode: streaming + non-streaming.
- Credentials: environment variables; secrets must never be committed to GitHub.
- Auth: Bearer API key with multiple keys.
- Stack: planner-selected Node.js + TypeScript.
- Upstream strategy: manually configured Gemini Web endpoint/cookies; README documents DevTools capture.
- API v1 scope: basic text chat + model list only.
- Model discovery: best-effort automatic; fallback to `gemini-web` and degraded health/log marker if probing fails.
- Conversation mode: stateless independent calls; no persistent storage.
- Tests: Vitest tests-after.
- Deployment: complete GitHub/Render loop.
- Render tier: Free Web Service, with cold-start/idle limitations documented.
- Security baseline: API key auth, rate limiting, CORS allowlist, log redaction, error isolation, request size limits.
- Rate limit default: 20 requests/API key/minute, configurable.

**Research Findings**:
- Workspace is greenfield: no `package.json`, source files, tests, deployment config, `.git`, or env files.
- Render requires binding to `0.0.0.0:$PORT`, supports HTTP health checks, but Free Web Service sleeps after idle and cold-starts around one minute.
- Gemini Web is not a standard OpenAI/Gemini API; it requires cookie-backed page token extraction and proprietary request/response conversion.
- Gemini Web responses may use Google `wrb.fr` frames with `)]}'` XSSI prefix and nested JSON; the service must parse/transform rather than transparently pipe.
- Streaming proxy must handle SSE heartbeats, backpressure, client disconnect aborts, chunk boundary splits, hop-by-hop header stripping, and secret redaction.

### Metis Review
**Identified Gaps** (addressed):
- Treat implementation as a protocol converter, not a transparent reverse proxy.
- Add token extraction module and explicit failure behavior for missing/invalid cookies.
- Add proprietary frame parser and fixtures/tests before live proxy integration.
- Add model discovery/fallback semantics and unknown-model error behavior.
- Add Render Free sleep/cold-start warnings and optional external ping guidance.
- Add strict guardrails against secret logging, conversation history pollution, and scope creep.

---

## Work Objectives

### Core Objective
Create a secure, deployable, OpenAI-compatible Gemini Web protocol adapter for personal/API use on Render Free Web Service, with explicit caveats for private Gemini Web protocol instability and free-tier reliability limits.

### Concrete Deliverables
- Node.js + TypeScript project scaffold.
- Native HTTP server with health, models, and chat completions routes.
- Environment-driven configuration with strict validation.
- Gemini Web auth bootstrap/token extraction.
- OpenAI request validation and Gemini Web request builder.
- Gemini Web frame parser and OpenAI response/SSE transformer.
- Security middleware: Bearer keys, CORS allowlist, request limits, rate limiting, redacted logs.
- Vitest tests and fixtures.
- Render deployment files and README with GitHub-safe secret handling.

### Definition of Done
- [x] `npm ci` succeeds.
- [x] `npm run build` succeeds.
- [x] `npm test` succeeds.
- [x] `npm start` serves `/health` on `0.0.0.0:$PORT`.
- [x] Unauthorized API requests return OpenAI-compatible 401 errors.
- [x] `/v1/models` returns discovered models or fallback `gemini-web` with degraded marker.
- [x] `/v1/chat/completions` supports non-streaming and streaming happy paths using mocked Gemini fixtures.
- [x] README documents local run, DevTools cookie/endpoint capture, Render env vars, Free tier caveats, and GitHub secret safety.

### Must Have
- Native Node HTTP/Fetch streaming design; avoid framework response buffering.
- Stateless chat requests only.
- Temporary Gemini Web chat mode where supported to avoid polluting the Google account chat history.
- No secret values committed or logged.
- Clear degradation/error behavior for model discovery and expired cookies.

### Must NOT Have (Guardrails)
- No image/multimodal support in v1.
- No OpenAI tool/function calling in v1.
- No persistent database or stateful conversation storage in v1.
- No multiple Google accounts in v1.
- No automatic Gemini Web endpoint discovery in v1.
- No transparent `pipeline()` pass-through for Gemini response frames.
- No storage of extracted `SNlM0e`, `cfb2h`, `FdrFJe` tokens outside process memory.
- No secrets in `.env.example`, README examples, logs, test snapshots, or GitHub.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No acceptance criteria may require manual confirmation.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: Tests-after
- **Framework**: Vitest
- **Agent-Executed QA**: Always required for every task.

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Bash with `curl` and Node scripts.
- **Streaming**: `curl -sN` and exact SSE line assertions.
- **Library/Module**: `npm test -- <pattern>` and fixture-based assertions.
- **Deployment config**: Static file inspection plus `npm run build` and Render command validation.

### Edge Case Registry
The executor must track tests or implementation notes for at least these edge classes:
- E1-E5: missing env vars, malformed env vars, empty API keys, CORS deny, oversized body.
- E6-E10: unauthorized bearer token, malformed JSON, unsupported method/path, unsupported `stream` type, invalid `messages`.
- E11-E15: unknown role, system role mapping, empty user content, unsupported image/tool fields, unknown model.
- E16-E20: upstream timeout, upstream 401/403, quota/rate-limit-like upstream errors, Render cold start, client disconnect.
- E21-E25: SSE heartbeat, `[DONE]` termination, no `Content-Length`, backpressure drain, hop-by-hop header stripping.
- E26-E29: secret redaction in logs/errors, stateless behavior, temp chat flag, degraded model fallback.
- E30-E37: Gemini Web `)]}'` prefix, optional numeric length lines, non-`wrb.fr` frames, nested JSON nulls, all-null sparse arrays, retryable temporary errors, HTML token extraction missing partial tokens, token strings with escapable characters.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation + independent modules):
â”œâ”€â”€ T1: Project scaffold, scripts, TypeScript build/test tooling [quick]
â”œâ”€â”€ T2: Environment config, secret redaction, runtime validation [quick]
â”œâ”€â”€ T3: Native HTTP server shell, health routes, graceful shutdown [quick]
â”œâ”€â”€ T4: OpenAI-compatible schemas, errors, auth/CORS/rate-limit primitives [unspecified-high]
â”œâ”€â”€ T5: Gemini Web token extraction bootstrap [deep]
â””â”€â”€ T6: Model discovery/fallback and model mapping contract [unspecified-high]

Wave 2 (Protocol conversion, after Wave 1 contracts):
â”œâ”€â”€ T7: OpenAI messages â†?Gemini Web request builder [deep]
â”œâ”€â”€ T8: Gemini Web frame parser fixtures and transformer core [deep]
â”œâ”€â”€ T9: Non-streaming chat completion route integration [unspecified-high]
â”œâ”€â”€ T10: Streaming SSE chat completion route integration [deep]
â””â”€â”€ T11: Security/ops hardening integration [unspecified-high]

Wave 3 (Docs, deployment, end-to-end verification):
â”œâ”€â”€ T12: README, .env.example, .gitignore, render.yaml, GitHub/Render deployment docs [writing]
â”œâ”€â”€ T13: Vitest integration/contract test suite and fixture coverage [unspecified-high]
â””â”€â”€ T14: Local runbook and mock end-to-end curl QA evidence [quick]

Wave FINAL:
â”œâ”€â”€ F1: Plan compliance audit (oracle)
â”œâ”€â”€ F2: Code quality review (unspecified-high)
â”œâ”€â”€ F3: Real manual QA by agent using curl/streaming evidence (unspecified-high)
â””â”€â”€ F4: Scope fidelity check (deep)
```

### Dependency Matrix
- **T1**: blocks T2-T14.
- **T2**: depends T1; blocks T3, T5, T11, T12.
- **T3**: depends T1-T2; blocks T9, T10, T14.
- **T4**: depends T1-T2; blocks T9, T10, T11, T13.
- **T5**: depends T1-T2; blocks T7, T9, T10, T13.
- **T6**: depends T1-T2, T5 optional; blocks T9, T10, T12.
- **T7**: depends T4-T6; blocks T9, T10, T13.
- **T8**: depends T1; blocks T9, T10, T13.
- **T9**: depends T3-T8; blocks T13, T14.
- **T10**: depends T3-T8; blocks T13, T14.
- **T11**: depends T2-T4; blocks T13, T14.
- **T12**: depends T2-T6; blocks final handoff.
- **T13**: depends T7-T11; blocks T14.
- **T14**: depends T9-T13; blocks final verification.

### Agent Dispatch Summary
- **Wave 1**: T1 quick, T2 quick, T3 quick, T4 unspecified-high, T5 deep, T6 unspecified-high.
- **Wave 2**: T7 deep, T8 deep, T9 unspecified-high, T10 deep, T11 unspecified-high.
- **Wave 3**: T12 writing, T13 unspecified-high, T14 quick.
- **FINAL**: F1 oracle, F2 unspecified-high, F3 unspecified-high, F4 deep.

---

## TODOs

> Implementation + Test = ONE Task. Every task includes QA scenarios. The executor has no interview context; references below are the guide.
>
> **Ordering note**: Execute by task number and dependency matrix above (T1 â†?T14). Due to incremental plan writing, task detail blocks below may appear in grouped insertion order; task numbers and dependency matrix are authoritative.

---

### Task Details: T11-T14

- [x] 11. Security and operations hardening integration

  **What to do**:
  - Integrate auth, CORS, rate limiting, request size limits, redacted structured logs, and controlled error isolation across all routes.
  - Strip hop-by-hop headers from upstream/downstream proxy logic.
  - Add rate-limit headers where appropriate.

  **Must NOT do**:
  - Do not log cookies, extracted tokens, full authorization headers, or raw Gemini responses containing sensitive content.
  - Do not allow wildcard CORS in production unless `ALLOWED_ORIGINS=*` is explicitly configured.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` â€?cross-cutting security and failure handling.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T2-T4
  - **Parallel Group**: Wave 2
  - **Blocks**: T13, T14
  - **Blocked By**: T2, T3, T4

  **References**:
  - User security choice: production baseline protection.
  - Render/streaming research: hop-by-hop headers, safe errors, no secret logs.

  **Acceptance Criteria**:
  - [x] Unauthorized, CORS-denied, oversized, and rate-limited requests fail safely.
  - [x] Logs redact known secret substrings.
  - [x] Errors are OpenAI-compatible for `/v1/*` routes.

  **QA Scenarios**:
  ```
  Scenario: CORS deny works
    Tool: Bash (curl)
    Preconditions: ALLOWED_ORIGINS=https://allowed.example
    Steps:
      1. Send request with `Origin: https://blocked.example`
      2. Assert response does not include permissive `Access-Control-Allow-Origin`
    Expected Result: Blocked origin is not allowed
    Evidence: .sisyphus/evidence/task-11-cors-deny.txt

  Scenario: Secret redaction in errors/logs
    Tool: Bash
    Preconditions: Server run with known fake secrets `SECRET_COOKIE_VALUE`, `SECRET_TOKEN_VALUE`
    Steps:
      1. Trigger upstream auth failure
      2. Grep captured logs and response for those exact substrings
    Expected Result: No exact secret substrings found; redacted markers present
    Evidence: .sisyphus/evidence/task-11-redaction-grep.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 12. README, `.env.example`, `.gitignore`, `render.yaml`, and deployment docs

  **What to do**:
  - Create README with architecture, local run, OpenAI-compatible examples, DevTools cookie/endpoint capture, Render env setup, GitHub secret safety, Free tier caveats, and upgrade path.
  - Create `.env.example` with placeholders only.
  - Create `.gitignore` excluding `.env`, logs, build artifacts, node_modules.
  - Create `render.yaml` for Free Web Service-compatible deploy: build command, start command, health check path, env var placeholders where safe.

  **Must NOT do**:
  - Do not include real cookies, real endpoint query tokens, real API keys, or copied browser values.
  - Do not promise Render Free production reliability; document cold starts/idle sleep.

  **Recommended Agent Profile**:
  - **Category**: `writing` â€?deployment docs and user-facing operational guide.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES in Wave 3 after contracts
  - **Parallel Group**: Wave 3
  - **Blocks**: final handoff
  - **Blocked By**: T2, T5, T6

  **References**:
  - Render Web Service docs: build/start/health/env vars.
  - User decision: GitHub-ready complete deployment loop and detailed capture docs.

  **Acceptance Criteria**:
  - [x] README includes exact env var table and `curl` examples.
  - [x] README includes Render Free limitations and UptimeRobot/external ping note.
  - [x] `.env.example` contains only placeholders.
  - [x] `render.yaml` uses `npm ci && npm run build`, `npm start`, and `/health`.

  **QA Scenarios**:
  ```
  Scenario: Docs contain deployment essentials
    Tool: Bash
    Preconditions: README and render.yaml exist
    Steps:
      1. Inspect README for `GEMINI_COOKIE`, `API_KEYS`, `ALLOWED_ORIGINS`, `Render Free`, `/v1/chat/completions`
      2. Inspect render.yaml for build/start command and health check path
    Expected Result: All required strings present
    Evidence: .sisyphus/evidence/task-12-docs-check.txt

  Scenario: GitHub secret safety
    Tool: Bash
    Preconditions: Docs and env example exist
    Steps:
      1. Search committed files for `__Secure-1PSID=`, `SNlM0e=`, `Bearer ` with non-placeholder values
      2. Assert `.gitignore` excludes `.env`
    Expected Result: No real secrets or risky sample values committed
    Evidence: .sisyphus/evidence/task-12-secret-safety.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 13. Vitest integration and contract test suite

  **What to do**:
  - Add tests covering config, redaction, auth, CORS, rate limits, request builder, token extraction, frame parser, non-streaming route, streaming route, and error mapping.
  - Use mock Gemini fixtures; no live Google calls in automated tests by default.
  - Cover edge registry E1-E37 through tests or explicit implementation assertions.

  **Must NOT do**:
  - Do not require real Gemini cookies for normal `npm test`.
  - Do not snapshot raw secrets or private response payloads.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` â€?broad contract coverage across modules.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T7-T11
  - **Parallel Group**: Wave 3
  - **Blocks**: T14
  - **Blocked By**: T7, T8, T9, T10, T11

  **References**:
  - Verification Strategy edge registry E1-E37.
  - Vitest docs/patterns for Node HTTP route tests.

  **Acceptance Criteria**:
  - [x] `npm test` passes without network access to Google.
  - [x] Tests include exact SSE `[DONE]` assertion.
  - [x] Tests include chunk-boundary frame parser matrix.
  - [x] Tests include no-secret log/response checks.

  **QA Scenarios**:
  ```
  Scenario: Full test suite passes offline
    Tool: Bash
    Preconditions: Dependencies installed, network to Google disabled/not required
    Steps:
      1. Run `npm test`
      2. Assert all suites pass
    Expected Result: Zero failing tests; no live Gemini credentials required
    Evidence: .sisyphus/evidence/task-13-tests.txt

  Scenario: Edge registry coverage check
    Tool: Bash
    Preconditions: Tests and docs implemented
    Steps:
      1. Search tests/docs for E1 through E37 identifiers or equivalent named cases
      2. Assert every edge is covered by a test or explicit implementation note
    Expected Result: No missing edge references
    Evidence: .sisyphus/evidence/task-13-edge-coverage.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 14. Local runbook and mock end-to-end curl QA evidence

  **What to do**:
  - Add a mock upstream mode or test harness so local curl QA can run without real Gemini cookies.
  - Produce local E2E evidence for health, models, unauthorized, non-streaming chat, and streaming chat.
  - Ensure examples match README commands.

  **Must NOT do**:
  - Do not use real Gemini cookies for shared evidence files.
  - Do not mark live Render deployment complete without actual Render URL evidence if deployment is executed later.

  **Recommended Agent Profile**:
  - **Category**: `quick` â€?final local QA harness and evidence capture.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO, final implementation QA before review
  - **Parallel Group**: Wave 3
  - **Blocks**: Final verification
  - **Blocked By**: T9, T10, T11, T12, T13

  **References**:
  - README curl examples.
  - T9/T10 route behavior.

  **Acceptance Criteria**:
  - [x] Mock-mode local server can be started with documented env vars.
  - [x] Evidence captured for all required endpoints.
  - [x] Streaming output validates exact OpenAI SSE format.

  **QA Scenarios**:
  ```
  Scenario: Local mock E2E happy path
    Tool: Bash (curl)
    Preconditions: Server running in mock upstream mode on PORT=10000 with API_KEYS=test-key
    Steps:
      1. GET `/health`
      2. GET `/v1/models` with bearer token
      3. POST non-stream chat with `Say hello`
    Expected Result: All responses are HTTP 200 with OpenAI-compatible JSON
    Evidence: .sisyphus/evidence/task-14-local-e2e.txt

  Scenario: Local mock streaming E2E
    Tool: Bash (curl -sN)
    Preconditions: Server running in mock upstream mode
    Steps:
      1. POST `/v1/chat/completions` with `stream:true`
      2. Capture raw output
      3. Assert output contains `data: {`, `chat.completion.chunk`, and final `data: [DONE]`
    Expected Result: Valid streaming response without buffering full text first
    Evidence: .sisyphus/evidence/task-14-stream-e2e.txt
  ```

  **Commit**: YES (group with all tasks)

---

### Task Details: T6-T10

- [x] 6. Model discovery/fallback and model mapping contract

  **What to do**:
  - Implement `/v1/models` data provider that attempts best-effort Gemini Web model discovery when feasible.
  - Maintain static fallback alias `gemini-web` and optional internal hex model mapping table.
  - Mark readiness/model status as degraded when discovery fails but fallback is active.

  **Must NOT do**:
  - Do not require user to manually set a model name.
  - Do not claim exact Gemini model identity if only fallback alias is known.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` â€?private API uncertainty and compatibility behavior.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T1/T2, optional T5
  - **Parallel Group**: Wave 1
  - **Blocks**: T9, T10, T12
  - **Blocked By**: T1, T2

  **References**:
  - OpenAI `/v1/models` shape: `object: list`, `data[].id`, `data[].object: model`.
  - User decision: auto model discovery with fallback alias.

  **Acceptance Criteria**:
  - [x] Authorized `GET /v1/models` returns OpenAI-compatible list.
  - [x] Discovery failure still returns `gemini-web` and sets degraded metadata/readiness.
  - [x] Unknown chat model returns controlled 400 unless mapped/fallback-compatible.

  **QA Scenarios**:
  ```
  Scenario: Model list fallback works
    Tool: Bash (curl)
    Preconditions: Server running with model discovery mocked to fail
    Steps:
      1. `curl -i http://127.0.0.1:10000/v1/models -H "Authorization: Bearer test-key"`
      2. Assert HTTP 200 and JSON includes `data[0].id` = `gemini-web`
    Expected Result: Fallback list returned and readiness is degraded, not failed
    Evidence: .sisyphus/evidence/task-6-model-fallback.txt

  Scenario: Unknown chat model rejected
    Tool: Bash (curl)
    Preconditions: Chat route wired with schema validation
    Steps:
      1. POST `/v1/chat/completions` with `model:"gpt-4"`
      2. Assert HTTP 400 OpenAI-compatible error code `model_not_supported`
    Expected Result: No upstream Gemini call attempted
    Evidence: .sisyphus/evidence/task-6-unknown-model.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 7. OpenAI messages to Gemini Web request builder

  **What to do**:
  - Implement `src/transform/request-builder.ts` converting text-only OpenAI messages into Gemini Web `f.req` form body.
  - Map `stream=true/false`, model mapping, user/assistant history, and system message default behavior.
  - Set temporary chat/history-avoidance flag where supported by the known `f.req` layout.

  **Must NOT do**:
  - Do not support images/tool calls silently.
  - Do not hardcode real cookies/tokens in fixtures.

  **Recommended Agent Profile**:
  - **Category**: `deep` â€?protocol conversion and fragile sparse-array format.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES in Wave 2 after contracts
  - **Parallel Group**: Wave 2
  - **Blocks**: T9, T10, T13
  - **Blocked By**: T4, T5, T6

  **References**:
  - Metis research: Gemini Web uses `application/x-www-form-urlencoded` and sparse `f.req` array.
  - OpenAI messages contract and user decision: stateless text-only calls.

  **Acceptance Criteria**:
  - [x] Valid text messages generate URL-encoded form body with `f.req` and auth token parameter.
  - [x] System messages are prepended to first user message per default decision.
  - [x] Unsupported content types return validation errors before upstream call.

  **QA Scenarios**:
  ```
  Scenario: Basic messages convert to f.req
    Tool: Bash
    Preconditions: Vitest fixtures for user/assistant/system messages
    Steps:
      1. Run `npm test -- request-builder`
      2. Assert generated body includes `f.req`, stream flag, temporary-chat flag, and no raw API key
    Expected Result: Builder tests pass
    Evidence: .sisyphus/evidence/task-7-request-builder.txt

  Scenario: Image content rejected
    Tool: Bash
    Preconditions: Validation tests exist
    Steps:
      1. Run `npm test -- unsupported-content`
      2. Assert image/tool request produces OpenAI-style 400 error
    Expected Result: No Gemini request body generated
    Evidence: .sisyphus/evidence/task-7-unsupported.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 8. Gemini Web frame parser fixtures and transformer core

  **What to do**:
  - Implement `src/transform/frame-parser.ts` for `)]}'` prefix, optional length lines, `wrb.fr` frames, non-response frames, chunk splits, nested JSON, and cumulative text diff extraction.
  - Provide transformer outputs usable by both non-streaming aggregation and SSE streaming.
  - Add fixtures for split boundaries: 1, 2, 5, 10, 100, 200 bytes and single chunk.

  **Must NOT do**:
  - Do not use standard EventSource parsing for Gemini upstream frames.
  - Do not pass raw `wrb.fr` data to OpenAI clients.

  **Recommended Agent Profile**:
  - **Category**: `deep` â€?highest-risk parser and streaming correctness.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES in Wave 2 after T1
  - **Parallel Group**: Wave 2
  - **Blocks**: T9, T10, T13
  - **Blocked By**: T1

  **References**:
  - Metis research: Google `wrb.fr` line-delimited frames and nested JSON.
  - Streaming proxy gotchas: chunk boundaries are arbitrary; parse complete events/lines.

  **Acceptance Criteria**:
  - [x] Parser extracts identical text regardless of chunk boundary size.
  - [x] Non-`wrb.fr` frames are ignored safely.
  - [x] Known upstream error frames map to OpenAI-compatible error metadata.

  **QA Scenarios**:
  ```
  Scenario: Chunk boundary parser stability
    Tool: Bash
    Preconditions: Fixture raw Gemini frame stream available
    Steps:
      1. Run `npm test -- frame-parser-boundaries`
      2. Assert outputs for 1/2/5/10/100/200-byte chunks equal single-chunk output
    Expected Result: All boundary tests pass with identical final text
    Evidence: .sisyphus/evidence/task-8-boundaries.txt

  Scenario: Non-response and malformed frames handled
    Tool: Bash
    Preconditions: Fixtures include `di`, `af.httprm`, null inner arrays, malformed line
    Steps:
      1. Run `npm test -- frame-parser-errors`
      2. Assert ignored frames do not throw and malformed frames produce controlled parser error
    Expected Result: No crash; controlled error classification
    Evidence: .sisyphus/evidence/task-8-frame-errors.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 9. Non-streaming chat completion route integration

  **What to do**:
  - Wire `POST /v1/chat/completions` for `stream:false` or omitted.
  - Validate/authenticate request, build Gemini request, call upstream/mock upstream, aggregate parsed text, return OpenAI-compatible JSON.
  - Map upstream/auth/parser errors to OpenAI error objects.

  **Must NOT do**:
  - Do not expose upstream raw response frames.
  - Do not store conversations between requests.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` â€?integration of auth, validation, upstream, parser, response contract.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T3-T8
  - **Parallel Group**: Wave 2
  - **Blocks**: T13, T14
  - **Blocked By**: T3, T4, T5, T6, T7, T8

  **References**:
  - OpenAI Chat Completions JSON response shape.
  - T7 request builder and T8 parser outputs.

  **Acceptance Criteria**:
  - [x] Valid non-streaming request returns `object: chat.completion` and `choices[0].message.content`.
  - [x] Upstream auth failure returns 502 `gemini_auth_expired` or equivalent controlled code.
  - [x] Repeated requests remain stateless.

  **QA Scenarios**:
  ```
  Scenario: Non-streaming happy path
    Tool: Bash (curl)
    Preconditions: Server running against mocked Gemini fixture
    Steps:
      1. POST `/v1/chat/completions` with `model:"gemini-web"`, `messages:[{"role":"user","content":"Say hello"}]`
      2. Assert HTTP 200, `object` = `chat.completion`, and content equals fixture text
    Expected Result: OpenAI-compatible JSON response
    Evidence: .sisyphus/evidence/task-9-nonstream-happy.json

  Scenario: Stateless second request
    Tool: Bash (curl)
    Preconditions: Server running against mocked Gemini fixture
    Steps:
      1. Send request A with content `First`
      2. Send request B with content `Second`
      3. Assert request B output contains no data from request A unless included in B messages
    Expected Result: No persisted conversation state
    Evidence: .sisyphus/evidence/task-9-stateless.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 10. Streaming SSE chat completion route integration

  **What to do**:
  - Wire `POST /v1/chat/completions` for `stream:true`.
  - Convert parser deltas to OpenAI SSE chunks: `data: {json}\n\n`, then `data: [DONE]\n\n`.
  - Add heartbeat comments, backpressure handling, client disconnect abort propagation, and no `Content-Length`.

  **Must NOT do**:
  - Do not buffer full response before streaming.
  - Do not omit `[DONE]` on normal completion.

  **Recommended Agent Profile**:
  - **Category**: `deep` â€?streaming correctness, backpressure, client lifecycle.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T3-T8
  - **Parallel Group**: Wave 2
  - **Blocks**: T13, T14
  - **Blocked By**: T3, T4, T5, T6, T7, T8

  **References**:
  - OpenAI streaming chunk shape: `object: chat.completion.chunk`, `delta.content`, final `[DONE]`.
  - Streaming proxy research: heartbeat, abort, backpressure, hop-by-hop stripping.

  **Acceptance Criteria**:
  - [x] `curl -sN` receives incremental `data:` events and final `[DONE]`.
  - [x] Response headers include `text/event-stream` and omit `Content-Length`.
  - [x] Client disconnect aborts upstream request.

  **QA Scenarios**:
  ```
  Scenario: Streaming happy path
    Tool: Bash (curl)
    Preconditions: Server running against delayed mocked Gemini fixture
    Steps:
      1. Run `curl -sN` POST with `stream:true`
      2. Assert output contains at least one `data: {` chunk and ends with `data: [DONE]`
    Expected Result: Valid OpenAI SSE stream
    Evidence: .sisyphus/evidence/task-10-stream-happy.txt

  Scenario: Streaming headers and disconnect
    Tool: Bash
    Preconditions: Server running with slow mock upstream
    Steps:
      1. Start streaming request and terminate client after first chunk
      2. Assert server logs/metrics show upstream abort and no secret leakage
    Expected Result: Upstream fetch cancelled; process remains healthy
    Evidence: .sisyphus/evidence/task-10-disconnect.txt
  ```

  **Commit**: YES (group with all tasks)

---

### Task Details: T1-T5

- [x] 1. Project scaffold, scripts, and TypeScript build/test tooling

  **What to do**:
  - Create Node.js + TypeScript project files: `package.json`, `tsconfig.json`, `src/`, `tests/`, `vitest.config.ts`.
  - Use Node 20+ assumptions, strict TypeScript, `tsx` for dev, `esbuild` or equivalent for production build.
  - Add scripts: `dev`, `build`, `start`, `test`, `test:run`.

  **Must NOT do**:
  - Do not add web frameworks that may buffer streaming responses unless justified and disabled for streaming.
  - Do not create `.env` with real values.

  **Recommended Agent Profile**:
  - **Category**: `quick` â€?greenfield tooling scaffold with conventional Node files.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T2-T14
  - **Blocked By**: None

  **References**:
  - Render Node/Web Service docs: build/start commands and `$PORT` requirement.
  - Node.js TypeScript production pattern: strict TS, dev runner, production build output.

  **Acceptance Criteria**:
  - [x] `npm ci` succeeds from lockfile.
  - [x] `npm run build` emits runnable output under `dist/`.
  - [x] `npm test` runs Vitest with at least one placeholder scaffold test.

  **QA Scenarios**:
  ```
  Scenario: Build tooling works
    Tool: Bash
    Preconditions: Fresh checkout, no node_modules
    Steps:
      1. Run `npm ci`
      2. Run `npm run build`
      3. Run `npm test`
    Expected Result: All commands exit 0; `dist/` exists after build
    Failure Indicators: Missing lockfile, TypeScript compile failure, missing scripts
    Evidence: .sisyphus/evidence/task-1-build-tooling.txt

  Scenario: No secrets scaffolded
    Tool: Bash
    Preconditions: Project files created
    Steps:
      1. Search repository files for sample secret-like values: `__Secure-1PSID`, `SNlM0e`, `AIza`, `Bearer sk-`
      2. Confirm only placeholder names appear in `.env.example`/README
    Expected Result: No real secret values found
    Evidence: .sisyphus/evidence/task-1-no-secrets.txt
  ```

  **Commit**: YES (group with all tasks)
  - Message: `feat(proxy): expose Gemini Web through OpenAI-compatible API`

- [x] 2. Environment config, secret redaction, and runtime validation

  **What to do**:
  - Implement `src/config.ts` for env parsing and validation.
  - Standardize env vars: `GEMINI_COOKIE`, `GEMINI_COOKIE_TS`, `GEMINI_COOKIE_CC`, `GEMINI_ENDPOINT`, `API_KEYS`, `ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `PORT`, `NODE_ENV`.
  - Implement redaction utility for cookies, tokens, API keys, auth headers, and upstream URLs containing sensitive query params.

  **Must NOT do**:
  - Do not silently start with missing `GEMINI_COOKIE`, `GEMINI_COOKIE_TS`, or empty `API_KEYS` in production mode.
  - Do not print full env values in errors/logs.

  **Recommended Agent Profile**:
  - **Category**: `quick` â€?focused config module and validation tests.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T1
  - **Parallel Group**: Wave 1
  - **Blocks**: T3, T5, T11, T12
  - **Blocked By**: T1

  **References**:
  - `.env.example` to be created in T12 â€?ensure placeholder-only values.
  - Render env var docs â€?secrets configured in dashboard/Blueprint, not committed.

  **Acceptance Criteria**:
  - [x] Missing production secrets cause explicit startup failure.
  - [x] Development/test mode can use mock config for tests.
  - [x] Redaction masks known sensitive substrings in logs/errors.

  **QA Scenarios**:
  ```
  Scenario: Missing production env fails safely
    Tool: Bash
    Preconditions: Build exists
    Steps:
      1. Run app with `NODE_ENV=production` and without GEMINI_COOKIE/API_KEYS
      2. Capture stderr and exit code
    Expected Result: Process exits non-zero with redacted, actionable missing-env message
    Evidence: .sisyphus/evidence/task-2-missing-env.txt

  Scenario: Redaction removes secrets
    Tool: Bash
    Preconditions: Tests created
    Steps:
      1. Run `npm test -- redaction`
      2. Assert strings `SECRET_COOKIE_VALUE` and `SECRET_API_KEY_VALUE` do not appear in test output snapshots/log captures
    Expected Result: Tests pass; output contains `[REDACTED]`
    Evidence: .sisyphus/evidence/task-2-redaction.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 3. Native HTTP server shell, health routes, and graceful shutdown

  **What to do**:
  - Implement native `node:http` server binding to `0.0.0.0:$PORT`.
  - Add `/health`, `/health/live`, `/health/ready`.
  - Configure keep-alive/header timeouts and `SIGTERM` graceful shutdown.
  - Ensure JSON 404/405 handling.

  **Must NOT do**:
  - Do not bind only to localhost.
  - Do not make `/health` depend on live Gemini calls; use `/health/ready` for degraded status details.

  **Recommended Agent Profile**:
  - **Category**: `quick` â€?server shell and basic routes.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T1/T2
  - **Parallel Group**: Wave 1
  - **Blocks**: T9, T10, T14
  - **Blocked By**: T1, T2

  **References**:
  - Render Web Services docs: `$PORT`, `0.0.0.0`, health check path.
  - Render graceful shutdown docs: SIGTERM behavior.

  **Acceptance Criteria**:
  - [x] `npm start` serves `/health` and returns 200 JSON.
  - [x] Unknown path returns JSON 404.
  - [x] Unsupported method returns JSON 405.

  **QA Scenarios**:
  ```
  Scenario: Health endpoint works
    Tool: Bash (curl)
    Preconditions: Server running with test env on PORT=10000
    Steps:
      1. `curl -i http://127.0.0.1:10000/health`
      2. Assert HTTP 200 and JSON field `status` equals `ok`
    Expected Result: Health response completes under 5s
    Evidence: .sisyphus/evidence/task-3-health.txt

  Scenario: Unknown route is controlled error
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. `curl -i http://127.0.0.1:10000/not-found`
      2. Assert HTTP 404 and JSON error body
    Expected Result: No stack trace or secret appears
    Evidence: .sisyphus/evidence/task-3-404.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 4. OpenAI-compatible schemas, errors, auth, CORS, and rate-limit primitives

  **What to do**:
  - Implement request/response types for `ChatCompletionRequest`, chunks, models, and OpenAI error objects.
  - Add Bearer auth using multiple `API_KEYS`.
  - Add `ALLOWED_ORIGINS` CORS handling.
  - Add request body size limit and conservative rate limiter default `20/min/key`.

  **Must NOT do**:
  - Do not accept unauthenticated `/v1/*` calls.
  - Do not allow unsupported multimodal/tool fields silently; return explicit unsupported errors.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` â€?API contract, security primitives, and edge validation.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T1/T2
  - **Parallel Group**: Wave 1
  - **Blocks**: T9, T10, T11, T13
  - **Blocked By**: T1, T2

  **References**:
  - OpenAI Chat Completions response/chunk/error shapes.
  - User decisions: text-only v1, model list endpoint, multiple API keys, conservative rate limit.

  **Acceptance Criteria**:
  - [x] Missing/invalid bearer token returns 401 OpenAI-style error.
  - [x] Unsupported image/tool request returns 400 OpenAI-style error.
  - [x] Rate limit returns 429 with rate-limit headers.

  **QA Scenarios**:
  ```
  Scenario: Unauthorized request rejected
    Tool: Bash (curl)
    Preconditions: Server running with API_KEYS=test-key
    Steps:
      1. `curl -i http://127.0.0.1:10000/v1/models`
      2. Assert HTTP 401 and body contains `error.type`
    Expected Result: No model data returned
    Evidence: .sisyphus/evidence/task-4-unauthorized.txt

  Scenario: Rate limit triggers
    Tool: Bash
    Preconditions: Server running with RATE_LIMIT_PER_MINUTE=2 and API_KEYS=test-key
    Steps:
      1. Send 3 authorized `/v1/models` requests in one minute
      2. Assert third response is HTTP 429 with OpenAI-style error
    Expected Result: Limit enforced per API key
    Evidence: .sisyphus/evidence/task-4-rate-limit.txt
  ```

  **Commit**: YES (group with all tasks)

- [x] 5. Gemini Web token extraction bootstrap

  **What to do**:
  - Implement `src/auth/token-extractor.ts` to fetch `https://gemini.google.com/app` using env cookies.
  - Extract `SNlM0e`, `cfb2h`, and `FdrFJe` tokens from HTML when present.
  - Cache tokens in memory only.
  - Fail startup or readiness clearly when cookies are missing/invalid.
  - Retry token extraction once on auth-expired errors during requests.

  **Must NOT do**:
  - Do not persist extracted tokens to disk.
  - Do not implement background `RotateCookies` in v1 unless user explicitly changes scope.

  **Recommended Agent Profile**:
  - **Category**: `deep` â€?high-risk private protocol auth with security-sensitive failure modes.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES after T1/T2
  - **Parallel Group**: Wave 1
  - **Blocks**: T7, T9, T10, T13
  - **Blocked By**: T1, T2

  **References**:
  - Metis research: Gemini Web requires page tokens `SNlM0e`, `cfb2h`, `FdrFJe` in addition to cookies.
  - README DevTools capture docs from T12.

  **Acceptance Criteria**:
  - [x] Mock HTML containing all three tokens extracts successfully.
  - [x] Missing any token fails with redacted error.
  - [x] 401/403 upstream token page response maps to startup/readiness failure.

  **QA Scenarios**:
  ```
  Scenario: Token extraction succeeds from fixture
    Tool: Bash
    Preconditions: Fixture HTML contains SNlM0e/cfb2h/FdrFJe-like values
    Steps:
      1. Run `npm test -- token-extractor`
      2. Assert extracted token object has all three fields
    Expected Result: Test passes; tokens not printed in raw form
    Evidence: .sisyphus/evidence/task-5-token-extract.txt

  Scenario: Invalid cookie path fails safely
    Tool: Bash
    Preconditions: Mock upstream returns 403 or login page without tokens
    Steps:
      1. Run `npm test -- token-extractor-invalid`
      2. Assert failure message is redacted and classified as auth setup failure
    Expected Result: No secret value appears in output
    Evidence: .sisyphus/evidence/task-5-token-invalid.txt
  ```

  **Commit**: YES (group with all tasks)

---

## Final Verification Wave (MANDATORY â€?after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** â€?`oracle`
  Read the plan end-to-end. Verify every Must Have and Must NOT Have. Check evidence files exist in `.sisyphus/evidence/`. Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`.

- [x] F2. **Code Quality Review** â€?`unspecified-high`
  Run `npm run build`, `npm test`, and lint/type checks if available. Review all changed files for secret leakage, `any` abuse, empty catches, debug logs, commented-out code, unused imports, and over-abstraction. Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`.

- [x] F3. **Real Manual QA** â€?`unspecified-high`
  Start from clean state. Execute every QA scenario from every task with exact curl/Node commands. Save terminal outputs and response bodies to `.sisyphus/evidence/final-qa/`. Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`.

- [x] F4. **Scope Fidelity Check** â€?`deep`
  Compare implementation diff against this plan. Reject scope creep: images, tool calls, stateful DB, multi-account, automatic endpoint discovery, cookie refresh if not explicitly approved. Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`.

---

## Commit Strategy

- Suggested single final commit after all tasks and verification: `feat(proxy): expose Gemini Web through OpenAI-compatible API`
- Do not commit secrets. Do not commit `.env`. Commit `.env.example` only with placeholder values.

---

## Success Criteria

### Verification Commands
```bash
npm ci
npm run build
npm test
npm start
curl -i http://localhost:10000/health
curl -i http://localhost:10000/v1/models -H "Authorization: Bearer test-key"
curl -sN http://localhost:10000/v1/chat/completions -H "Authorization: Bearer test-key" -H "Content-Type: application/json" -d '{"model":"gemini-web","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```

### Final Checklist
- [x] All Must Have items present.
- [x] All Must NOT Have items absent.
- [x] All tests pass.
- [x] All QA evidence files exist.
- [x] README documents Render Free limitations and upgrade path.
- [x] No secrets in repository files or logs.
