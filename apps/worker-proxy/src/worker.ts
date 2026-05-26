import {
  CHAT_ENDPOINT_PATH,
  HOBO_CLIENT_ID_HEADER,
  JSON_CONTENT_TYPE,
  PROVIDER_NAMES,
  type ChatRequest,
  type ChatResponse,
  type ProviderName
} from "@hobo/shared";

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type Env = {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  HOBO_RATE_LIMIT_MAX_PER_MINUTE?: string;
  MY_RATE_LIMITER?: RateLimitBinding;
};

type DevRateEntry = {
  windowStartMs: number;
  count: number;
};

const PROVIDER_TIMEOUT_MS = 4000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const devRateLimits = new Map<string, DevRateEntry>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, ${HOBO_CLIENT_ID_HEADER}`
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_CONTENT_TYPE, ...CORS_HEADERS }
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

function isChatRequest(value: unknown): value is ChatRequest {
  if (!value || typeof value !== "object") return false;

  const candidate = value as { messages?: unknown; systemPrompt?: unknown };
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) return false;

  for (const message of candidate.messages) {
    if (!message || typeof message !== "object") return false;
    const m = message as { role?: unknown; content?: unknown };
    if (m.role !== "user" && m.role !== "assistant") return false;
    if (typeof m.content !== "string" || m.content.trim().length === 0) return false;
  }

  if (candidate.systemPrompt != null && typeof candidate.systemPrompt !== "string") {
    return false;
  }

  return true;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getRateLimitMax(env: Env) {
  const parsed = Number(env.HOBO_RATE_LIMIT_MAX_PER_MINUTE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

async function isRateLimited(clientId: string, env: Env, nowMs = Date.now()) {
  if (env.MY_RATE_LIMITER) {
    try {
      const result = await env.MY_RATE_LIMITER.limit({ key: clientId });
      return !result.success;
    } catch (error) {
      console.warn("Cloudflare rate limiter unavailable; using dev fallback", error);
    }
  }

  const max = getRateLimitMax(env);
  const current = devRateLimits.get(clientId);

  if (!current || nowMs - current.windowStartMs >= RATE_LIMIT_WINDOW_MS) {
    devRateLimits.set(clientId, { windowStartMs: nowMs, count: 1 });
    return false;
  }

  current.count += 1;
  return current.count > max;
}

function withSystemPrompt(request: ChatRequest) {
  return [
    ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
    ...request.messages
  ];
}

async function callOpenAiCompatibleProvider(
  provider: "groq" | "cerebras",
  request: ChatRequest,
  env: Env
): Promise<ChatResponse | null> {
  const isGroq = provider === "groq";
  const key = isGroq ? env.GROQ_API_KEY : env.CEREBRAS_API_KEY;
  if (!key) return null;

  const response = await fetchWithTimeout(
    isGroq
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.cerebras.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: isGroq ? "llama-3.3-70b-versatile" : "llama3.3-70b",
        messages: withSystemPrompt(request),
        max_tokens: 150,
        temperature: 0.8,
        stream: false
      })
    },
    PROVIDER_TIMEOUT_MS
  );

  if (!response.ok) {
    console.warn(`${provider} returned ${response.status}`);
    return null;
  }

  const raw = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const text = raw.choices?.[0]?.message?.content;
  return typeof text === "string" ? { text, routedProvider: provider } : null;
}

async function callGoogleProvider(
  request: ChatRequest,
  env: Env
): Promise<ChatResponse | null> {
  if (!env.GEMINI_API_KEY) return null;

  const response = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" +
      `?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": JSON_CONTENT_TYPE },
      body: JSON.stringify({
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }]
        })),
        ...(request.systemPrompt
          ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } }
          : {}),
        generationConfig: { maxOutputTokens: 150, temperature: 0.8 }
      })
    },
    PROVIDER_TIMEOUT_MS
  );

  if (!response.ok) {
    console.warn(`google returned ${response.status}`);
    return null;
  }

  const raw = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? { text, routedProvider: "google" } : null;
}

async function callProvider(
  provider: ProviderName,
  request: ChatRequest,
  env: Env
): Promise<ChatResponse | null> {
  try {
    if (provider === "google") return await callGoogleProvider(request, env);
    return await callOpenAiCompatibleProvider(provider, request, env);
  } catch (error) {
    console.warn(`${provider} failed`, error);
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return preflight();
    }

    if (url.pathname !== CHAT_ENDPOINT_PATH) {
      return json(404, { error: "Not found" });
    }

    if (request.method !== "POST") {
      return json(405, { error: "Method not allowed" });
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

    const clientId = request.headers.get(HOBO_CLIENT_ID_HEADER);
    if (!clientId || clientId.length > 200) {
      return json(400, { error: "Invalid client id" });
    }

    if (await isRateLimited(clientId, env)) {
      return json(429, { error: "Rate limit exceeded" });
    }

    for (const provider of PROVIDER_NAMES) {
      const result = await callProvider(provider, payload, env);
      if (result) return json(200, result);
    }

    return json(503, { error: "All providers unavailable" });
  }
};
