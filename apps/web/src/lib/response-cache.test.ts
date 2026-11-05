import { describe, expect, it, vi } from "vitest";
import {
  authResponseCacheControl,
  PRIVATE_NO_STORE,
  privateResponseMiddleware,
} from "./response-cache";

const HTML = "text/html; charset=utf-8";
// What Vercel sends when a function sets no Cache-Control of its own.
const VERCEL_DEFAULT = "public, max-age=0, must-revalidate";

describe("authResponseCacheControl", () => {
  it("keeps every server-function response out of shared and disk caches", () => {
    for (const signedIn of [true, false]) {
      expect(
        authResponseCacheControl({
          handlerType: "serverFn",
          signedIn,
          status: 200,
          contentType: "application/json",
        }),
      ).toBe(PRIVATE_NO_STORE);
    }
  });

  it("keeps signed-in pages and their redirects out of shared and disk caches", () => {
    expect(
      authResponseCacheControl({
        handlerType: "router",
        signedIn: true,
        status: 200,
        contentType: HTML,
      }),
    ).toBe(PRIVATE_NO_STORE);
    expect(
      authResponseCacheControl({
        handlerType: "router",
        signedIn: true,
        status: 404,
        contentType: HTML,
      }),
    ).toBe(PRIVATE_NO_STORE);
    expect(
      authResponseCacheControl({
        handlerType: "router",
        signedIn: true,
        status: 307,
        contentType: null,
      }),
    ).toBe(PRIVATE_NO_STORE);
  });

  it("leaves signed-out pages to their own caching", () => {
    expect(
      authResponseCacheControl({
        handlerType: "router",
        signedIn: false,
        status: 200,
        contentType: HTML,
      }),
    ).toBeNull();
  });

  it("leaves server routes such as /ingest and /sitemap.xml alone, signed in or not", () => {
    for (const contentType of [
      "application/javascript",
      "application/xml; charset=utf-8",
      "application/json",
    ]) {
      expect(
        authResponseCacheControl({
          handlerType: "router",
          signedIn: true,
          status: 200,
          contentType,
        }),
      ).toBeNull();
    }
  });
});

type Auth = (opts: { treatPendingAsSignedOut: boolean }) => {
  userId: string | null;
};

async function run(opts: {
  handlerType: "serverFn" | "router";
  auth?: Auth;
  response: Response;
}) {
  const next = vi.fn(async () => ({ response: opts.response }));
  const server = privateResponseMiddleware.options.server as unknown as (ctx: {
    request: Request;
    pathname: string;
    handlerType: "serverFn" | "router";
    context: { auth?: Auth };
    next: typeof next;
  }) => Promise<{ response: Response }>;
  const result = await server({
    request: new Request("https://jigswap.site/dashboard"),
    pathname: "/dashboard",
    handlerType: opts.handlerType,
    context: opts.auth ? { auth: opts.auth } : {},
    next,
  });
  return result.response.headers.get("cache-control");
}

function html() {
  return new Response("<!doctype html>", {
    headers: { "content-type": HTML, "cache-control": VERCEL_DEFAULT },
  });
}

describe("privateResponseMiddleware", () => {
  it("marks a signed-in member's page private, no-store", async () => {
    const auth = vi.fn<Auth>(() => ({ userId: "user_1" }));
    expect(await run({ handlerType: "router", auth, response: html() })).toBe(
      PRIVATE_NO_STORE,
    );
    // A pending session (sign-up tasks left) still belongs to one person.
    expect(auth).toHaveBeenCalledWith({ treatPendingAsSignedOut: false });
  });

  it("leaves a signed-out page's Cache-Control untouched", async () => {
    expect(
      await run({
        handlerType: "router",
        auth: () => ({ userId: null }),
        response: html(),
      }),
    ).toBe(VERCEL_DEFAULT);
  });

  it("marks a signed-out visitor's server-function response private, no-store", async () => {
    expect(
      await run({
        handlerType: "serverFn",
        auth: () => ({ userId: null }),
        response: Response.json({ userId: null }),
      }),
    ).toBe(PRIVATE_NO_STORE);
  });

  it("treats a request without Clerk's auth context as signed in", async () => {
    expect(await run({ handlerType: "router", response: html() })).toBe(
      PRIVATE_NO_STORE,
    );
  });
});
