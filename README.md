# Hobo

Hobo is a mobile chat app backed by a Cloudflare Worker proxy. The mobile app sends chat requests to `POST /chat`; the Worker keeps provider keys off-device, routes across Groq, Gemini, and Cerebras, and normalizes responses for the app.

## Workspace

```powershell
pnpm install
```

## Worker Proxy

Create `apps/worker-proxy/.dev.vars` locally with any provider keys you want to test:

```dotenv
GROQ_API_KEY=...
GEMINI_API_KEY=...
CEREBRAS_API_KEY=...
HOBO_RATE_LIMIT_MAX_PER_MINUTE=30
```

Run the Worker locally:

```powershell
pnpm -C apps/worker-proxy dev
```

The local chat endpoint defaults to:

```text
http://127.0.0.1:8787/chat
```

## Mobile App

Run Expo:

```powershell
pnpm -C apps/mobile start
```

The current MVP app uses the local Worker URL above and stores a stable client id with AsyncStorage for `X-Hobo-Client-ID`.

## Checks

```powershell
pnpm -r typecheck
pnpm -C apps/worker-proxy test
```
