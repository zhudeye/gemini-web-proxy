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
| `GEMINI_COOKIE` | yes | Combined cookie string: `__Secure-1PSID=xxx; __Secure-1PSIDTS=yyy; __Secure-1PSIDCC=zzz` (CC optional). |
| `API_KEYS` | yes | Comma-separated Bearer API keys accepted by the proxy. |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS allowlist. |
| `RATE_LIMIT_PER_MINUTE` | no | Default `20` requests per API key per minute. |
| `GEMINI_ENDPOINT` | no | Override auto-discovered endpoint URL. Not needed for most deployments. |

Never commit real cookie, token, or API key values. Use `.env.example` only as a placeholder template.

## Capturing Gemini Web Cookies

1. Open `https://gemini.google.com/app` in the browser account you want to proxy.
2. Open DevTools → Application/Storage → Cookies → `https://gemini.google.com`.
3. Build a single combined cookie string:
   ```
   __Secure-1PSID=<paste-psid-value>; __Secure-1PSIDTS=<paste-psidts-value>; __Secure-1PSIDCC=<paste-psidcc-value>
   ```
   (The `__Secure-1PSIDCC` part is optional.)
4. Paste this combined string into the `GEMINI_COOKIE` Render environment variable.

The proxy will auto-discover the Gemini Web conversation endpoint from your session tokens, so no manual endpoint capture is needed.

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

v1 supports text-only stateless chat, model listing, and automatic endpoint discovery from session tokens. It intentionally does not support images, tool calls, multiple Google accounts, persistent conversations, or automatic cookie rotation.
