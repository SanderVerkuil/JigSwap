import { describe, expect, it } from "vitest";
import { clerkFrontendApiOrigin, preconnectLinks } from "./preconnect";

// Publishable keys are `pk_test_` / `pk_live_` + base64("<frontend api host>$"), padding optional.
const key = (prefix: string, decoded: string, pad = true) => {
  const encoded = btoa(decoded);
  return prefix + (pad ? encoded : encoded.replace(/=+$/, ""));
};

describe("clerkFrontendApiOrigin", () => {
  it("decodes a development key's Frontend API host", () => {
    expect(
      clerkFrontendApiOrigin(
        key("pk_test_", "giddy-octopus-72.clerk.accounts.dev$"),
      ),
    ).toBe("https://giddy-octopus-72.clerk.accounts.dev");
  });

  it("decodes a production key's custom Frontend API domain, unpadded", () => {
    expect(
      clerkFrontendApiOrigin(key("pk_live_", "clerk.jigswap.site$", false)),
    ).toBe("https://clerk.jigswap.site");
  });

  it.each<[string, string | undefined]>([
    ["no key", undefined],
    ["an empty key", ""],
    ["an unknown prefix", key("sk_live_", "clerk.jigswap.site$")],
    ["no trailing $", key("pk_live_", "clerk.jigswap.site")],
    ["more than one $", key("pk_live_", "clerk$jigswap.site$")],
    ["no dot in the host", key("pk_live_", "localhost$")],
    ["a path in the host", key("pk_live_", "evil.example/x$")],
    ["invalid base64", "pk_live_%%%"],
  ])("returns null for %s", (_label, value) => {
    expect(clerkFrontendApiOrigin(value)).toBeNull();
  });
});

describe("preconnectLinks", () => {
  it("warms Clerk for its anonymous scripts and credentialed API calls, and Convex", () => {
    expect(
      preconnectLinks({
        clerkPublishableKey: key("pk_live_", "clerk.jigswap.site$"),
        convexUrl: "https://giddy-octopus-727.eu-west-1.convex.cloud",
      }),
    ).toEqual([
      {
        rel: "preconnect",
        href: "https://clerk.jigswap.site",
        crossOrigin: "anonymous",
      },
      { rel: "preconnect", href: "https://clerk.jigswap.site" },
      {
        rel: "preconnect",
        href: "https://giddy-octopus-727.eu-west-1.convex.cloud",
      },
    ]);
  });

  it("skips whatever is missing or malformed", () => {
    expect(
      preconnectLinks({ clerkPublishableKey: "nope", convexUrl: "not a url" }),
    ).toEqual([]);
    expect(preconnectLinks({})).toEqual([]);
  });
});
