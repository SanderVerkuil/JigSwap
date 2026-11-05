import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "./security-headers";

// Header names are matched case-insensitively by browsers; normalise once.
const headers = new Headers(SECURITY_HEADERS);

function permissions(): Map<string, string> {
  const policy = headers.get("permissions-policy") ?? "";
  return new Map(
    policy.split(",").map((entry) => {
      const [feature, allow] = entry.trim().split("=");
      return [feature, allow];
    }),
  );
}

describe("SECURITY_HEADERS", () => {
  it("forbids every page from being framed, in old and new browsers", () => {
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'",
    );
  });

  it("enforces nothing but frame-ancestors until the report-only CSP has run", () => {
    // An enforced script-src/style-src here would break the app before the
    // report-only policy has shown what it blocks.
    const directives = (headers.get("content-security-policy") ?? "")
      .split(";")
      .map((d) => d.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(directives).toEqual(["frame-ancestors"]);
  });

  it("pins HTTPS for two years on the domain and its subdomains, without preload", () => {
    expect(headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("stops MIME sniffing", () => {
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps the same-origin Referer but sends only the origin cross-site", () => {
    // Same-origin requests keep the full Referer, which CSRF origin checks
    // fall back on; never tighten this to no-referrer.
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("lets only our own pages ask for location and the camera, and nothing for mic, payment, USB or ad topics", () => {
    const policy = permissions();
    // The messaging location picker uses navigator.geolocation; the catalogue search's barcode
    // scanner uses navigator.mediaDevices.getUserMedia. Blocking either makes it fail as if the
    // member had refused it in their browser settings.
    expect(policy.get("geolocation")).toBe("(self)");
    expect(policy.get("camera")).toBe("(self)");
    for (const feature of ["microphone", "payment", "usb", "browsing-topics"]) {
      expect(policy.get(feature)).toBe("()");
    }
  });
});
