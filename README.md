# Gemini Web OpenAI-Compatible Proxy

Node.js + TypeScript service that exposes Gemini Web conversations through OpenAI-compatible endpoints and is deployable on Render Free Web Service.

## Endpoints

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /v1/models`
- `POST /v1/chat/completions`

`/v1/*` routes require `Authorization: Bearer <API_KEY>`.

## Local Development

```bash
npm ci
npm run build
npm test
npm start
```

Non-production mode uses mock Gemini defaults so tests can run without real cookies.

## Environment Variables

| Name | Required in production | Description |
|---|---:|---|
| `NODE_ENV` | yes | Use `production` on Render. |
| `PORT` | no | Render injects this automatically; default local port is `8080`. |
| `GEMINI_COOKIE` | yes | Value of the browser `__Secure-1PSID` cookie. |
| `GEMINI_COOKIE_TS` | yes | Value of the browser `__Secure-1PSIDTS` cookie. |
| `GEMINI_COOKIE_CC` | no | Optional `__Secure-1PSIDCC` cookie. |
| `GEMINI_ENDPOINT` | yes | Manually captured Gemini Web endpoint URL. |
| `API_KEYS` | yes | Comma-separated Bearer API keys accepted by the proxy. |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS allowlist. |
| `RATE_LIMIT_PER_MINUTE` | no | Default `20` requests per API key per minute. |

Never commit real cookie, token, endpoint, or API key values. Use `.env.example` only as a placeholder template.

## Capturing Gemini Web Cookies and Endpoint

1. Open `https://gemini.google.com/app` in the browser account you want to proxy.
2. Open DevTools → Application/Storage → Cookies → `https://gemini.google.com`.
3. Copy only the values for:
   - `__Secure-1PSID` → `GEMINI_COOKIE`
   - `__Secure-1PSIDTS` → `GEMINI_COOKIE_TS`
   - `__Secure-1PSIDCC` → `GEMINI_COOKIE_CC` if present
4. Open DevTools → Network.
5. Send a short Gemini message.
6. Find the Gemini Web request used for conversation generation and copy the endpoint URL into `GEMINI_ENDPOINT`.
7. Paste these values into Render Environment variables, not into repository files.

Cookie/session values expire. v1 intentionally does not implement automatic cookie rotation; update Render env vars manually when auth expires.

## OpenAI-Compatible Usage

```bash
curl -s http://localhost:8080/v1/models \
  -H "Authorization: Bearer test-key"
```

```bash
curl -s http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-web","messages":[{"role":"user","content":"Say hello"}]}'
```

Streaming:

```bash
curl -sN http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer test-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-web","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```

## Render Deployment

1. Push this repository to GitHub.
2. Create a Render Web Service from the repository or use `render.yaml` as a Blueprint.
3. Use build command `npm ci && npm run build`.
4. Use start command `npm start`.
5. Set health check path to `/health`.
6. Configure all production secrets in Render Environment.

### Render Free Limitations

Render Free Web Services can sleep after idle periods and cold starts may take about a minute. Active SSE output is not a reliability guarantee for production usage. For better reliability, upgrade to a paid Starter Web Service. If you stay on Free, an external HTTP ping to `/health` every ~10 minutes can reduce cold starts.

## Scope

v1 supports text-only stateless chat and model listing. It intentionally does not support images, tool calls, multiple Google accounts, persistent conversations, automatic endpoint discovery, or automatic cookie rotation.
