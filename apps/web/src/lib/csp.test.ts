import { afterEach, describe, expect, it, vi } from "vitest";
import { createCspNonce, cspMiddleware } from "./csp";

const HTML = "text/html; charset=utf-8";

type HandlerType = "serverFn" | "router";
type Next = (opts?: {
  context?: { cspNonce?: string };
}) => Promise<{ response: Response }>;

// Runs cspMiddleware alone; `next` stands in for the rest of the chain and the render.
async function run(opts: { handlerType: HandlerType; response?: Response }) {
  const response =
    opts.response ??
    new Response("<!doctype html>", { headers: { "content-type": HTML } });
  const next = vi.fn<Next>(async () => ({ response }));
  const server = cspMiddleware.options.server as unknown as (ctx: {
    request: Request;
    pathname: string;
    handlerType: HandlerType;
    context: Record<string, unknown>;
    next: Next;
  }) => Promise<{ response: Response }>;
  const result = await server({
    request: new Request("https://jigswap.site/catalog"),
    pathname: "/catalog",
    handlerType: opts.handlerType,
    context: {},
    next,
  });
  const nonce = next.mock.calls[0]?.[0]?.context?.cspNonce;
  return { nonce, headers: result.response.headers };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCspNonce", () => {
  it("is 128 random bits, base64, and new every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, createCspNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});

describe("cspMiddleware", () => {
  it("hands every production page render a fresh nonce", async () => {
    vi.stubEnv("DEV", false);
    const first = await run({ handlerType: "router" });
    const second = await run({ handlerType: "router" });
    expect(first.nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(second.nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(first.nonce).not.toBe(second.nonce);
  });

  it("gives server functions no nonce: they render no HTML", async () => {
    vi.stubEnv("DEV", false);
    expect(
      (await run({ handlerType: "serverFn", response: Response.json({}) }))
        .nonce,
    ).toBeUndefined();
  });

  it("gives no nonce in dev, where Vite injects its own inline scripts", async () => {
    vi.stubEnv("DEV", true);
    expect((await run({ handlerType: "router" })).nonce).toBeUndefined();
  });

  it("gives no nonce to prerendered pages, which are served as static files", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("TSS_PRERENDERING", "true");
    expect((await run({ handlerType: "router" })).nonce).toBeUndefined();
  });
});
