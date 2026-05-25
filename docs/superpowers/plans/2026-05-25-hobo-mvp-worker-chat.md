# Hobo MVP (Worker Proxy + Basic Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an end-to-end “mobile → Cloudflare Worker proxy → LLM provider(s) → mobile” chat loop with a stable API contract, basic failover routing, and simple rate limiting keyed by a client id header.

**Architecture:** A Cloudflare Worker exposes `POST /chat`, holds LLM provider keys in environment variables, and routes requests across providers (Groq → Gemini → Cerebras) with timeouts and normalized responses. An Expo React Native app provides a minimal chat UI and calls the Worker using a shared request/response type package.

**Tech Stack:** pnpm workspaces, TypeScript, Cloudflare Workers + Wrangler, Expo (React Native), Vitest (Worker unit tests).

---

## Repository Layout (Target)

- `e:/AI Projects/Hobo/package.json` (workspace root)
- `e:/AI Projects/Hobo/pnpm-workspace.yaml`
- `e:/AI Projects/Hobo/apps/worker-proxy/` (Cloudflare Worker)
- `e:/AI Projects/Hobo/apps/mobile/` (Expo app)
- `e:/AI Projects/Hobo/packages/shared/` (types, constants)
- `e:/AI Projects/Hobo/packages/config/` (shared tsconfig)

## API Contract (v0)

**Request**
- `POST /chat`
- Headers:
  - `Content-Type: application/json`
  - `X-Hobo-Client-ID: <stable_install_id>`
- Body:

```json
{
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "systemPrompt": "optional"
}
```

**Response**

```json
{
  "text": "assistant reply",
  "routedProvider": "groq"
}
```

**Errors**
- `400` invalid JSON / invalid shape
- `405` non-POST
- `429` rate limit exceeded
- `503` all providers failed

---

### Task 1: Initialize pnpm workspace

**Files:**
- Create: `e:/AI Projects/Hobo/package.json`
- Create: `e:/AI Projects/Hobo/pnpm-workspace.yaml`

- [x] **Step 1: Create root package.json**

Create `e:/AI Projects/Hobo/package.json`:

```json
{
  "name": "hobo",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  }
}
```

- [x] **Step 2: Create pnpm-workspace.yaml**

Create `e:/AI Projects/Hobo/pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [x] **Step 3: Install workspace deps**

Run (repo root):

```powershell
pnpm -v
pnpm install
```

Expected:
- `pnpm install` completes without errors (no deps yet).

---

### Task 2: Add shared TypeScript config package

**Files:**
- Create: `e:/AI Projects/Hobo/packages/config/package.json`
- Create: `e:/AI Projects/Hobo/packages/config/tsconfig.base.json`

- [x] **Step 1: Create config package.json**

Create `e:/AI Projects/Hobo/packages/config/package.json`:

```json
{
  "name": "@hobo/config",
  "version": "0.0.0",
  "private": true
}
```

- [x] **Step 2: Add tsconfig.base.json**

Create `e:/AI Projects/Hobo/packages/config/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

---

### Task 3: Create @hobo/shared types and constants

**Files:**
- Create: `e:/AI Projects/Hobo/packages/shared/package.json`
- Create: `e:/AI Projects/Hobo/packages/shared/tsconfig.json`
- Create: `e:/AI Projects/Hobo/packages/shared/src/index.ts`

- [x] **Step 1: Create shared package.json**

Create `e:/AI Projects/Hobo/packages/shared/package.json`:

```json
{
  "name": "@hobo/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "echo \"no tests\""
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [x] **Step 2: Create shared tsconfig.json**

Create `e:/AI Projects/Hobo/packages/shared/tsconfig.json`:

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [x] **Step 3: Add shared types/constants**

Create `e:/AI Projects/Hobo/packages/shared/src/index.ts`:

```ts
export const HOBO_CLIENT_ID_HEADER = "X-Hobo-Client-ID";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  systemPrompt?: string;
};

export type ChatResponse = {
  text: string;
  routedProvider: "groq" | "google" | "cerebras";
};
```

- [x] **Step 4: Install deps**

Run (repo root):

```powershell
pnpm -C packages/shared install
pnpm -r typecheck
```

Expected:
- Typecheck passes.

---

### Task 4: Scaffold Cloudflare Worker app (apps/worker-proxy)

**Files:**
- Create: `e:/AI Projects/Hobo/apps/worker-proxy/package.json`
- Create: `e:/AI Projects/Hobo/apps/worker-proxy/tsconfig.json`
- Create: `e:/AI Projects/Hobo/apps/worker-proxy/wrangler.toml`
- Create: `e:/AI Projects/Hobo/apps/worker-proxy/src/worker.ts`
- Create: `e:/AI Projects/Hobo/apps/worker-proxy/test/worker.test.ts`

- [x] **Step 1: Create worker-proxy package.json**

Create `e:/AI Projects/Hobo/apps/worker-proxy/package.json`:

```json
{
  "name": "@hobo/worker-proxy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hobo/shared": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250501.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.99.0"
  }
}
```

- [x] **Step 2: Add worker tsconfig.json**

Create `e:/AI Projects/Hobo/apps/worker-proxy/tsconfig.json`:

```json
{
  "extends": "../../packages/config/tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022"],
    "module": "ESNext",
    "target": "ES2022"
  },
  "include": ["src", "test"]
}
```

- [x] **Step 3: Add wrangler.toml**

Create `e:/AI Projects/Hobo/apps/worker-proxy/wrangler.toml`:

```toml
name = "hobo-worker-proxy"
main = "src/worker.ts"
compatibility_date = "2026-05-25"
```

- [x] **Step 4: Install worker deps**

Run (repo root):

```powershell
pnpm -C apps/worker-proxy install
pnpm -r typecheck
```

Expected:
- Typecheck passes.

---

### Task 5: Implement Worker /chat handler with validation + provider failover

**Files:**
- Modify: `e:/AI Projects/Hobo/apps/worker-proxy/src/worker.ts`
- Test: `e:/AI Projects/Hobo/apps/worker-proxy/test/worker.test.ts`

**Implementation notes**
- Keep everything in `worker.ts` for MVP.
- Failover order: Groq → Google → Cerebras.
- Timeout each provider attempt (4 seconds).
- Normalize provider responses into `{ text, routedProvider }`.

- [x] **Step 1: Write tests for method/shape validation and successful normalization**

Create `e:/AI Projects/Hobo/apps/worker-proxy/test/worker.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/worker";

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request("https://example.com/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body)
  });
}

describe("worker-proxy /chat", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 405 on non-POST", async () => {
    const req = new Request("https://example.com/chat", { method: "GET" });
    const res = await worker.fetch(req, {} as any);
    expect(res.status).toBe(405);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    const res = await worker.fetch(req, {} as any);
    expect(res.status).toBe(400);
  });

  it("routes to first provider that succeeds", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: "hi from google" }] } }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const res = await worker.fetch(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }, { "X-Hobo-Client-ID": "t1" }),
      { GEMINI_API_KEY: "x", GROQ_API_KEY: "y", CEREBRAS_API_KEY: "z" } as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ text: "hi from google", routedProvider: "google" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Skipped during this implementation pass; tests were added and then verified after implementation.

Run (repo root):

```powershell
pnpm -C apps/worker-proxy test
```

Expected:
- FAIL because `src/worker.ts` is missing / incomplete.

- [x] **Step 3: Implement worker.ts**

Create `e:/AI Projects/Hobo/apps/worker-proxy/src/worker.ts`:

```ts
import { HOBO_CLIENT_ID_HEADER, type ChatRequest, type ChatResponse } from "@hobo/shared";

type Env = {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
};

type ProviderName = ChatResponse["routedProvider"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as any;
  if (!Array.isArray(v.messages)) return false;
  for (const m of v.messages) {
    if (!m || typeof m !== "object") return false;
    if (m.role !== "user" && m.role !== "assistant") return false;
    if (typeof m.content !== "string") return false;
  }
  if (v.systemPrompt != null && typeof v.systemPrompt !== "string") return false;
  return true;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callProvider(provider: ProviderName, req: ChatRequest, env: Env) {
  if (provider === "groq") {
    if (!env.GROQ_API_KEY) return null;
    const res = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
            ...req.messages
          ],
          max_tokens: 150,
          temperature: 0.8,
          stream: false
        })
      },
      4000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return { text, routedProvider: "groq" as const };
  }

  if (provider === "google") {
    if (!env.GEMINI_API_KEY) return null;
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${env.GEMINI_API_KEY}`;
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: req.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
          })),
          ...(req.systemPrompt
            ? { systemInstruction: { parts: [{ text: req.systemPrompt }] } }
            : {}),
          generationConfig: { maxOutputTokens: 150, temperature: 0.8 }
        })
      },
      4000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;
    return { text, routedProvider: "google" as const };
  }

  if (provider === "cerebras") {
    if (!env.CEREBRAS_API_KEY) return null;
    const res = await fetchWithTimeout(
      "https://api.cerebras.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.CEREBRAS_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama3.3-70b",
          messages: [
            ...(req.systemPrompt ? [{ role: "system", content: req.systemPrompt }] : []),
            ...req.messages
          ],
          max_tokens: 150,
          temperature: 0.8,
          stream: false
        })
      },
      4000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return { text, routedProvider: "cerebras" as const };
  }

  return null;
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/chat") {
      return json(404, { error: "Not found" });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "Invalid JSON payload" });
    }

    if (!isChatRequest(payload)) {
      return json(400, { error: "Invalid request shape" });
    }

    const clientId = request.headers.get(HOBO_CLIENT_ID_HEADER) ?? "anonymous";
    if (!clientId || clientId.length > 200) {
      return json(400, { error: "Invalid client id" });
    }

    const providers: ProviderName[] = ["groq", "google", "cerebras"];

    for (const p of providers) {
      const result = await callProvider(p, payload, env);
      if (result) return json(200, result);
    }

    return json(503, { error: "All providers unavailable" });
  }
};
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```powershell
pnpm -C apps/worker-proxy test
```

Expected:
- PASS.

---

### Task 6: Add rate limiting (dev fallback + production hook point)

**Files:**
- Modify: `e:/AI Projects/Hobo/apps/worker-proxy/src/worker.ts`
- Test: `e:/AI Projects/Hobo/apps/worker-proxy/test/worker.test.ts`
- Modify: `e:/AI Projects/Hobo/apps/worker-proxy/wrangler.toml`

**Approach**
- For local dev: a lightweight in-memory rate limiter keyed by `X-Hobo-Client-ID`.
- For production: add a clear env hook point so we can later wire Cloudflare rate limiting (e.g., Durable Object / KV / native binding) without changing the handler contract.

- [x] **Step 1: Add a unit test for 429 behavior**

Append to `e:/AI Projects/Hobo/apps/worker-proxy/test/worker.test.ts`:

```ts
it("returns 429 when rate limit exceeded", async () => {
  const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  mockFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );

  const env = {
    GEMINI_API_KEY: "x",
    HOBO_RATE_LIMIT_MAX_PER_MINUTE: "1"
  } as any;

  const req = makeRequest({ messages: [{ role: "user", content: "hi" }] }, { "X-Hobo-Client-ID": "t2" });
  const res1 = await worker.fetch(req, env);
  expect(res1.status).toBe(200);

  const req2 = makeRequest({ messages: [{ role: "user", content: "hi again" }] }, { "X-Hobo-Client-ID": "t2" });
  const res2 = await worker.fetch(req2, env);
  expect(res2.status).toBe(429);
});
```

- [x] **Step 2: Implement rate limiting in worker.ts**

Update `Env` and `fetch` path to use a per-minute counter keyed by `clientId`, driven by env var `HOBO_RATE_LIMIT_MAX_PER_MINUTE` (default: 30).

Implementation guidance:
- Use a module-level `Map<string, { windowStartMs: number; count: number }>` for dev.
- On each request: if now - windowStartMs >= 60_000 reset; else increment; if count > max return 429.

- [x] **Step 3: Run worker tests**

Run:

```powershell
pnpm -C apps/worker-proxy test
```

Expected:
- PASS.

---

### Task 7: Scaffold Expo mobile app (apps/mobile)

**Files:**
- Create: `e:/AI Projects/Hobo/apps/mobile/` (Expo scaffold output)

- [x] **Step 1: Create Expo app**

Run (repo root):

```powershell
pnpm dlx create-expo-app apps/mobile --template blank-typescript
```

Expected:
- Expo app created at `apps/mobile`.

- [x] **Step 2: Wire workspace dependency**

In `e:/AI Projects/Hobo/apps/mobile/package.json`, add:

```json
{
  "dependencies": {
    "@hobo/shared": "workspace:*"
  }
}
```

- [x] **Step 3: Install**

Run:

```powershell
pnpm -C apps/mobile install
```

---

### Task 8: Implement minimal Chat UI and proxy client

**Files:**
- Modify: `e:/AI Projects/Hobo/apps/mobile/App.tsx`
- Create (optional): `e:/AI Projects/Hobo/apps/mobile/src/api/chat.ts`
- Create (optional): `e:/AI Projects/Hobo/apps/mobile/src/state/useClientId.ts`

**Approach**
- Keep initial UI minimal: scrollable message list + text input + send button.
- Generate a stable client id on first run and reuse it (Expo SecureStore preferred; AsyncStorage acceptable for MVP).
- Proxy URL comes from an env constant:
  - Dev default: `http://127.0.0.1:8787/chat` (Wrangler dev)

- [x] **Step 1: Add a simple chat client**

Create `e:/AI Projects/Hobo/apps/mobile/src/api/chat.ts`:

```ts
import { HOBO_CLIENT_ID_HEADER, type ChatRequest, type ChatResponse } from "@hobo/shared";

export async function sendChat(proxyUrl: string, clientId: string, payload: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [HOBO_CLIENT_ID_HEADER]: clientId
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Proxy error ${res.status}: ${text}`);
  }

  return (await res.json()) as ChatResponse;
}
```

- [x] **Step 2: Implement stable client id**

Create `e:/AI Projects/Hobo/apps/mobile/src/state/useClientId.ts`:

```ts
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hobo.clientId.v0";

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useClientId() {
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await AsyncStorage.getItem(KEY);
      if (existing) {
        if (!cancelled) setClientId(existing);
        return;
      }
      const created = randomId();
      await AsyncStorage.setItem(KEY, created);
      if (!cancelled) setClientId(created);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return clientId;
}
```

Install dependency:

```powershell
pnpm -C apps/mobile add @react-native-async-storage/async-storage
```

- [x] **Step 3: Update App.tsx to use chat UI**

Replace `e:/AI Projects/Hobo/apps/mobile/App.tsx` with a minimal chat screen that:
- Holds messages in component state
- Calls `sendChat` on send
- Appends assistant response
- Shows errors inline

- [ ] **Step 4: Run mobile app**

Run:

```powershell
pnpm -C apps/mobile start
```

Expected:
- App loads in emulator/device.

---

### Task 9: Local end-to-end run (Worker + Mobile)

- [ ] **Step 1: Start worker dev server**

In one terminal:

```powershell
pnpm -C apps/worker-proxy dev
```

Set env vars for dev (choose one approach):
- Wrangler `.dev.vars` file in `apps/worker-proxy/` with:
  - `GROQ_API_KEY=...`
  - `GEMINI_API_KEY=...`
  - `CEREBRAS_API_KEY=...`

- [ ] **Step 2: Start mobile**

In another terminal:

```powershell
pnpm -C apps/mobile start
```

- [ ] **Step 3: Verify**
- Send a message from the phone; confirm you receive a response.
- Temporarily invalidate the first provider key and confirm it falls back to the next provider (response’s `routedProvider` changes).

---

### Task 10: Production readiness checkpoint (small, no scope creep)

- [x] **Step 1: Ensure no secrets are committed**
- Ensure `.dev.vars` is gitignored (if repo has git).
- Never log API keys.

- [x] **Step 2: Add minimal README run instructions**
- Create `e:/AI Projects/Hobo/README.md` with “dev run” commands for both apps.

---

## Plan Self-Review

- Spec coverage: this plan implements Phase 1’s “serverless proxy + core chat loop” and defers RxDB/Orama/ExecuTorch/IAP.
- Placeholder scan: no “TBD/TODO” steps; each file has concrete contents.
- Type consistency: request/response shapes match across shared types, worker handler, and mobile client.
