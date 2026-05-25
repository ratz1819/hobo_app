import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request("https://example.com/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hobo-Client-ID": "test-client",
      ...(headers ?? {})
    },
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

  it("returns 404 for unknown paths", async () => {
    const req = new Request("https://example.com/nope", { method: "POST" });
    const res = await worker.fetch(req, {} as never);
    expect(res.status).toBe(404);
  });

  it("returns 405 on non-POST", async () => {
    const req = new Request("https://example.com/chat", { method: "GET" });
    const res = await worker.fetch(req, {} as never);
    expect(res.status).toBe(405);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new Request("https://example.com/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hobo-Client-ID": "test-client" },
      body: "{"
    });
    const res = await worker.fetch(req, {} as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid request shape", async () => {
    const res = await worker.fetch(makeRequest({ messages: [] }), {} as never);
    expect(res.status).toBe(400);
  });

  it("routes to first provider that succeeds", async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(new Response("no", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "hi from google" }] } }]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const res = await worker.fetch(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }),
      { GEMINI_API_KEY: "x", GROQ_API_KEY: "y", CEREBRAS_API_KEY: "z" } as never
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      text: "hi from google",
      routedProvider: "google"
    });
  });

  it("returns 429 when rate limit is exceeded", async () => {
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
    } as never;

    const res1 = await worker.fetch(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }, { "X-Hobo-Client-ID": "t2" }),
      env
    );
    expect(res1.status).toBe(200);

    const res2 = await worker.fetch(
      makeRequest(
        { messages: [{ role: "user", content: "hi again" }] },
        { "X-Hobo-Client-ID": "t2" }
      ),
      env
    );
    expect(res2.status).toBe(429);
  });
});
