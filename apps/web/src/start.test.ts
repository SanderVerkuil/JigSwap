import { csrfSymbol } from "@tanstack/react-start";
import { describe, expect, it, vi } from "vitest";
import { startInstance } from "./start";

type ServerCtx = {
  request: Request;
  pathname: string;
  handlerType: "serverFn" | "router";
  context: Record<string, unknown>;
  next: () => Promise<{ response: Response }>;
};
type RequestMiddleware = {
  options: { server: (ctx: ServerCtx) => Promise<unknown> | unknown };
};

async function requestMiddleware(): Promise<RequestMiddleware[]> {
  const options = await startInstance.getOptions();
  return (options.requestMiddleware ?? []) as unknown as RequestMiddleware[];
}

// Runs the first request middleware alone; `next` stands in for the rest of the chain.
async function runFirst(
  handlerType: ServerCtx["handlerType"],
  headers: Record<string, string>,
) {
  const [first] = await requestMiddleware();
  const ok = new Response("ok");
  const next = vi.fn(async () => ({ response: ok }));
  const url = "https://jigswap.site/_serverFn/abc";
  const result = await first.options.server({
    request: new Request(url, { headers }),
    pathname: new URL(url).pathname,
    handlerType,
    context: {},
    next,
  });
  const response =
    result instanceof Response
      ? result
      : (result as { response: Response }).response;
  return { status: response.status, reachedNext: next.mock.calls.length > 0 };
}

describe("request middleware", () => {
  it("checks server-function calls for CSRF before Clerk authenticates them", async () => {
    const [first, ...rest] = await requestMiddleware();
    expect(csrfSymbol in first).toBe(true);
    expect(rest.length).toBeGreaterThan(0);
  });

  it("refuses a cross-site server-function call", async () => {
    expect(
      await runFirst("serverFn", {
        "sec-fetch-site": "cross-site",
        origin: "https://evil.example",
      }),
    ).toEqual({ status: 403, reachedNext: false });
  });

  it("refuses a server-function call from another origin without fetch metadata", async () => {
    expect(
      await runFirst("serverFn", { origin: "https://evil.example" }),
    ).toEqual({ status: 403, reachedNext: false });
  });

  it("refuses a server-function call that carries no origin signal at all", async () => {
    expect(await runFirst("serverFn", {})).toEqual({
      status: 403,
      reachedNext: false,
    });
  });

  it("lets same-origin server-function calls through", async () => {
    expect(
      await runFirst("serverFn", { "sec-fetch-site": "same-origin" }),
    ).toEqual({ status: 200, reachedNext: true });
    expect(
      await runFirst("serverFn", { origin: "https://jigswap.site" }),
    ).toEqual({ status: 200, reachedNext: true });
  });

  it("leaves pages and server routes reachable from other sites", async () => {
    expect(
      await runFirst("router", { "sec-fetch-site": "cross-site" }),
    ).toEqual({ status: 200, reachedNext: true });
  });
});
