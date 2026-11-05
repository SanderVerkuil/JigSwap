import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCspReportOnly,
  clerkFrontendApiFromPublishableKey,
  createCspNonce,
  cspMiddleware,
} from "./csp";
import { CSP_REPORT_PATH } from "./csp-report";

const HTML = "text/html; charset=utf-8";
const CONVEX_URL = "https://giddy-octopus-727.eu-west-1.convex.cloud";
// Clerk publishable keys carry their Frontend API host, base64-encoded with a trailing "$".
const devKey = `pk_test_${btoa("example-frog-12.clerk.accounts.dev$")}`;
const liveKey = `pk_live_${btoa("clerk.jigswap.site$")}`;

// "script-src 'self' …; style-src …" → Map("script-src" → ["'self'", …]).
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
}

const policy = directives(
  buildCspReportOnly({
    nonce: "abc123+/==",
    convexUrl: CONVEX_URL,
    clerkPublishableKey: liveKey,
  }),
);

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

describe("clerkFrontendApiFromPublishableKey", () => {
  it("reads the Frontend API host of a development and a production key", () => {
    expect(clerkFrontendApiFromPublishableKey(devKey)).toBe(
      "example-frog-12.clerk.accounts.dev",
    );
    expect(clerkFrontendApiFromPublishableKey(liveKey)).toBe(
      "clerk.jigswap.site",
    );
  });

  it("returns null for anything that is not a plain host", () => {
    for (const key of [
      undefined,
      "",
      "pk_test_",
      "sk_test_" + btoa("clerk.jigswap.site$"),
      "pk_live_" + btoa("clerk.jigswap.site"),
      "pk_live_" + btoa("evil.example; script-src *$"),
      "pk_live_" + btoa("evil.example/path$"),
      "pk_live_not-base64!",
    ]) {
      expect(clerkFrontendApiFromPublishableKey(key)).toBeNull();
    }
  });
});

describe("buildCspReportOnly", () => {
  it("runs only scripts carrying this response's nonce, and what they load", () => {
    expect(policy.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123+/=='",
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      "https://clerk.jigswap.site",
      "https://challenges.cloudflare.com",
    ]);
    for (const sources of policy.values()) {
      expect(sources).not.toContain("'unsafe-eval'");
    }
  });

  it("lets the page talk to its own Convex deployment, Clerk and the emoji data CDN only", () => {
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      CONVEX_URL,
      "wss://giddy-octopus-727.eu-west-1.convex.cloud",
      "https://clerk.jigswap.site",
      "https://clerk-telemetry.com",
      "https://cdn.jsdelivr.net",
      "blob:",
    ]);
  });

  it("falls back to any Convex cloud host, and leaves Clerk out, when the env is missing", () => {
    const fallback = directives(buildCspReportOnly({ nonce: "n" }));
    expect(fallback.get("connect-src")).toEqual([
      "'self'",
      "https://*.convex.cloud",
      "wss://*.convex.cloud",
      "https://clerk-telemetry.com",
      "https://cdn.jsdelivr.net",
      "blob:",
    ]);
    expect(fallback.get("script-src")).toEqual([
      "'self'",
      "'nonce-n'",
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      "https://challenges.cloudflare.com",
    ]);
  });

  it("serves fonts, workers and the manifest from this origin only", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(policy.get("manifest-src")).toEqual(["'self'"]);
    expect(policy.get("frame-src")).toEqual([
      "https://challenges.cloudflare.com",
    ]);
  });

  it("allows images from any https host (store-page imports preview the retailer's image)", () => {
    expect(policy.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https:",
    ]);
  });

  it("shuts plugins, base-tag hijacks and off-site form posts", () => {
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("reports to /api/csp-report through report-uri", () => {
    expect(policy.get("report-uri")).toEqual([CSP_REPORT_PATH]);
    // With report-to present, Chromium would skip report-uri.
    expect(policy.has("report-to")).toBe(false);
  });

  it("leaves frame-ancestors to the enforced header", () => {
    // Report-only mode ignores frame-ancestors; security-headers.ts enforces it.
    expect(policy.has("frame-ancestors")).toBe(false);
  });

  it("ignores a Convex URL that is not a plain https origin", () => {
    const odd = directives(
      buildCspReportOnly({
        nonce: "n",
        convexUrl: "javascript:alert(1)",
      }),
    );
    expect(odd.get("connect-src")?.slice(1, 3)).toEqual([
      "https://*.convex.cloud",
      "wss://*.convex.cloud",
    ]);
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

  it("sends a production page the report-only policy for its own nonce", async () => {
    vi.stubEnv("DEV", false);
    const { nonce, headers } = await run({ handlerType: "router" });
    const header = headers.get("content-security-policy-report-only") ?? "";
    expect(directives(header).get("script-src")).toContain(`'nonce-${nonce}'`);
    // The enforced policy stays as it is (frame-ancestors only, from the route rules).
    expect(headers.has("content-security-policy")).toBe(false);
  });

  it("sends no policy with server-route responses such as /ingest", async () => {
    vi.stubEnv("DEV", false);
    const { headers } = await run({
      handlerType: "router",
      response: new Response("", {
        headers: { "content-type": "application/javascript" },
      }),
    });
    expect(headers.has("content-security-policy-report-only")).toBe(false);
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
    const { nonce, headers } = await run({ handlerType: "router" });
    expect(nonce).toBeUndefined();
    expect(headers.has("content-security-policy-report-only")).toBe(false);
  });

  it("gives no nonce to prerendered pages, which are served as static files", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("TSS_PRERENDERING", "true");
    const { nonce, headers } = await run({ handlerType: "router" });
    expect(nonce).toBeUndefined();
    expect(headers.has("content-security-policy-report-only")).toBe(false);
  });
});
