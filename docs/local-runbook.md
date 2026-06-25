# Local Mock Runbook

This project can run locally without real Gemini cookies when `NODE_ENV` is not `production`. The default mock Gemini endpoint is used by `loadConfig()`.

## Commands

```bash
npm ci
npm run build
npm start
```

## Verify

```bash
curl -i http://127.0.0.1:8080/health
curl -i http://127.0.0.1:8080/v1/models -H "Authorization: Bearer test-key"
curl -i http://127.0.0.1:8080/v1/chat/completions -H "Authorization: Bearer test-key" -H "Content-Type: application/json" -d '{"model":"gemini-web","messages":[{"role":"user","content":"Say hello"}]}'
curl -sN http://127.0.0.1:8080/v1/chat/completions -H "Authorization: Bearer test-key" -H "Content-Type: application/json" -d '{"model":"gemini-web","messages":[{"role":"user","content":"Say hello"}],"stream":true}'
```

Expected mock response content includes `Mock Gemini response to:`.
