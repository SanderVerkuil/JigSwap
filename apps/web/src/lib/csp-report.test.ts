import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_PATH,
  handleCspReport,
  parseCspReports,
} from "./csp-report";

// What Firefox sends to report-uri (Content-Type: application/csp-report).
const reportUriBody = {
  "csp-report": {
    "document-uri": "https://jigswap.site/members/ann?invite=tok#top",
    referrer: "https://jigswap.site/",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; report-uri /api/csp-report",
    disposition: "report",
    "blocked-uri": "https://evil.example/x.js?session=secret",
    "script-sample": "alert(document.cookie)",
    "status-code": 200,
  },
};

// What Chromium sends to the Reporting-Endpoints group
// (Content-Type: application/reports+json), batched with other report types.
const reportingApiBody = [
  {
    type: "csp-violation",
    age: 10,
    url: "https://jigswap.site/catalog?q=ravensburger",
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: "https://jigswap.site/catalog?q=ravensburger",
      effectiveDirective: "connect-src",
      blockedURL: "wss://other.convex.cloud/api/1.0/sync?token=x",
      disposition: "report",
      sample: "",
      statusCode: 200,
    },
  },
  {
    type: "deprecation",
    url: "https://jigswap.site/catalog",
    body: { id: "x", message: "y" },
  },
];

describe("parseCspReports", () => {
  it("reads a report-uri report down to directive, blocked origin and path", () => {
    expect(parseCspReports(JSON.stringify(reportUriBody))).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example",
        path: "/members/ann",
        disposition: "report",
      },
    ]);
  });

  it("reads Reporting API batches and skips other report types", () => {
    expect(parseCspReports(JSON.stringify(reportingApiBody))).toEqual([
      {
        directive: "connect-src",
        blocked: "wss://other.convex.cloud",
        path: "/catalog",
        disposition: "report",
      },
    ]);
  });

  it("never keeps a query string, fragment, script sample or URL path", () => {
    const logged = JSON.stringify([
      ...parseCspReports(JSON.stringify(reportUriBody)),
      ...parseCspReports(JSON.stringify(reportingApiBody)),
    ]);
    for (const leak of [
      "invite",
      "tok",
      "#top",
      "session",
      "secret",
      "x.js",
      "alert",
      "ravensburger",
      "token",
      "/api/1.0",
    ]) {
      expect(logged).not.toContain(leak);
    }
  });

  it("keeps the browser's keywords for inline code and reduces other schemes to their name", () => {
    const blocked = (blockedURL: string) =>
      parseCspReports(
        JSON.stringify([
          {
            type: "csp-violation",
            body: {
              documentURL: "https://jigswap.site/",
              effectiveDirective: "script-src-elem",
              blockedURL,
            },
          },
        ]),
      )[0]?.blocked;
    expect(blocked("inline")).toBe("inline");
    expect(blocked("eval")).toBe("eval");
    expect(blocked("wasm-eval")).toBe("wasm-eval");
    expect(blocked("data:text/javascript,alert(1)")).toBe("data");
    expect(blocked("blob:https://jigswap.site/1234")).toBe("blob");
    expect(blocked("chrome-extension://abcdef/script.js")).toBe(
      "chrome-extension",
    );
    expect(blocked("")).toBe("unknown");
    expect(blocked("<script>")).toBe("unknown");
  });

  it("takes the directive name from a CSP2 violated-directive and refuses odd ones", () => {
    const directive = (violated: string) =>
      parseCspReports(
        JSON.stringify({
          "csp-report": {
            "document-uri": "https://jigswap.site/",
            "violated-directive": violated,
            "blocked-uri": "inline",
          },
        }),
      )[0]?.directive;
    expect(directive("style-src 'self' 'unsafe-inline'")).toBe("style-src");
    expect(directive('script-src"\n{}')).toBe("unknown");
  });

  it("logs at most ten violations per request", () => {
    const many = Array.from({ length: 50 }, () => reportingApiBody[0]);
    expect(parseCspReports(JSON.stringify(many))).toHaveLength(10);
  });

  it("returns nothing for bodies that are not reports", () => {
    for (const body of ["", "not json", "null", "42", '{"a":1}', "[1,2]"]) {
      expect(parseCspReports(body)).toEqual([]);
    }
  });
});

describe("handleCspReport", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request(`https://jigswap.site${CSP_REPORT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/csp-report", ...headers },
      body,
    });

  it("logs one line per violation and answers 204", async () => {
    const response = await handleCspReport(post(JSON.stringify(reportUriBody)));
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0] as [string];
    expect(JSON.parse(line)).toEqual({
      event: "csp_violation",
      directive: "script-src-elem",
      blocked: "https://evil.example",
      path: "/members/ann",
      disposition: "report",
    });
  });

  it("refuses a body over the cap without logging", async () => {
    const big = JSON.stringify({
      "csp-report": {
        "document-uri": "https://jigswap.site/",
        "blocked-uri": "inline",
        "violated-directive": "script-src",
        padding: "x".repeat(CSP_REPORT_MAX_BYTES),
      },
    });
    // Streamed, so no Content-Length tells the size up front.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const response = await handleCspReport(
      new Request(`https://jigswap.site${CSP_REPORT_PATH}`, {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a declared oversize body before reading it", async () => {
    const response = await handleCspReport(
      post("{}", { "content-length": String(CSP_REPORT_MAX_BYTES + 1) }),
    );
    expect(response.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers 400 to a body that holds no report", async () => {
    const response = await handleCspReport(post("hello"));
    expect(response.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });
});
