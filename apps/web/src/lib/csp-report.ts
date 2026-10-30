// Receives Content-Security-Policy violation reports (routes/api/csp-report.ts) and writes one
// log line per violation, for the report-only policy's review before it is enforced. Reports
// carry the page URL, the blocked URL and a sample of the blocked code, any of which can hold a
// member's data (an invite token in a query, a message in a script sample), so only three facts
// are kept: the directive, the blocked origin (or the browser's keyword such as "inline"), and the
// page path without query or fragment.

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_MAX_BYTES = 8 * 1024;
// A page that trips one directive often trips it many times; ten lines per request is plenty.
const MAX_REPORTS_PER_REQUEST = 10;
const MAX_PATH_LENGTH = 200;

export type CspViolation = {
  directive: string;
  blocked: string;
  path: string;
  disposition: "report" | "enforce" | "unknown";
};

// What the browser writes instead of a URL for code with no URL of its own.
const BLOCKED_KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "self",
  "trusted-types-policy",
  "trusted-types-sink",
]);
const NETWORK_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

// "script-src-elem"; a CSP2 violated-directive carries its sources too ("style-src 'self' …").
function directiveName(value: string): string {
  const name = value.trim().split(/\s+/)[0] ?? "";
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown";
}

function blockedSource(value: string): string {
  if (BLOCKED_KEYWORDS.has(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "unknown";
  }
  if (NETWORK_SCHEMES.has(url.protocol)) return url.origin;
  const scheme = url.protocol.slice(0, -1);
  return /^[a-z][a-z0-9+.-]{0,30}$/.test(scheme) ? scheme : "unknown";
}

function documentPath(value: string): string {
  try {
    return new URL(value).pathname.slice(0, MAX_PATH_LENGTH);
  } catch {
    return "unknown";
  }
}

function disposition(value: string): CspViolation["disposition"] {
  return value === "report" || value === "enforce" ? value : "unknown";
}

function violation(fields: {
  directive: string;
  blocked: string;
  document: string;
  disposition: string;
}): CspViolation {
  return {
    directive: directiveName(fields.directive),
    blocked: blockedSource(fields.blocked),
    path: documentPath(fields.document),
    disposition: disposition(fields.disposition),
  };
}

// report-uri: { "csp-report": { "document-uri", "effective-directive", "blocked-uri", … } }
function fromReportUri(report: Raw): CspViolation {
  return violation({
    directive: str(
      report["effective-directive"] ?? report["violated-directive"],
    ),
    blocked: str(report["blocked-uri"]),
    document: str(report["document-uri"]),
    disposition: str(report.disposition),
  });
}

// Reporting API (report-to): [{ type: "csp-violation", body: { documentURL, … } }, …]
function fromReportingApi(body: Raw): CspViolation {
  return violation({
    directive: str(body.effectiveDirective),
    blocked: str(body.blockedURL),
    document: str(body.documentURL),
    disposition: str(body.disposition),
  });
}

export function parseCspReports(text: string): CspViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const violations: CspViolation[] = [];
  if (isRecord(parsed) && isRecord(parsed["csp-report"])) {
    violations.push(fromReportUri(parsed["csp-report"]));
  } else if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (violations.length >= MAX_REPORTS_PER_REQUEST) break;
      if (
        isRecord(entry) &&
        entry.type === "csp-violation" &&
        isRecord(entry.body)
      ) {
        violations.push(fromReportingApi(entry.body));
      }
    }
  }
  return violations;
}

// The body as text, or null once it passes `max` bytes (read no further).
async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function handleCspReport(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > CSP_REPORT_MAX_BYTES) {
    return new Response(null, { status: 413 });
  }
  const text = await readCapped(request, CSP_REPORT_MAX_BYTES);
  if (text === null) return new Response(null, { status: 413 });
  const violations = parseCspReports(text);
  if (violations.length === 0) return new Response(null, { status: 400 });
  for (const v of violations) {
    console.warn(JSON.stringify({ event: "csp_violation", ...v }));
  }
  return new Response(null, { status: 204 });
}
