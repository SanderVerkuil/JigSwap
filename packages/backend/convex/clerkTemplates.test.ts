import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import authConfig from "./auth.config";

// The Clerk configuration admin rights depend on lives in the Clerk dashboard. The expected version
// is kept in packages/backend/clerk/ (see its README); these checks keep that versioned copy honest.
// identity/isAdmin reads `metadata.role` from the "convex" JWT and the web admin guard reads it from
// the session token, so both must map `metadata` to the server-only public_metadata. The web writes
// unsafeMetadata (shell preferences) from the browser, so no claim may ever come from it.

type ClerkClaims = Record<string, unknown>;
type JwtTemplate = { name: string; claims: ClerkClaims };
type SessionToken = { claims: ClerkClaims };

const read = (file: string): string =>
  readFileSync(new URL(`../clerk/${file}`, import.meta.url), "utf8");

const convexTemplateSource = read("convex-jwt-template.json");
const sessionTokenSource = read("session-token.json");
const convexTemplate = JSON.parse(convexTemplateSource) as JwtTemplate;
const sessionToken = JSON.parse(sessionTokenSource) as SessionToken;

describe("versioned Clerk templates", () => {
  test("the Convex JWT template is the one the web asks for", () => {
    // apps/web fetches getToken({ template: "convex" }).
    expect(convexTemplate.name).toBe("convex");
  });

  test("the Convex JWT audience matches auth.config's applicationID", () => {
    expect(authConfig.providers.map((p) => p.applicationID)).toEqual([
      convexTemplate.claims.aud,
    ]);
  });

  test.each([
    ["convex JWT template", convexTemplate.claims],
    ["session token", sessionToken.claims],
  ] as const)("the %s maps metadata to public_metadata", (_name, claims) => {
    expect(claims.metadata).toBe("{{user.public_metadata}}");
  });

  test.each([
    ["convex JWT template", convexTemplate.claims],
    ["session token", sessionToken.claims],
  ] as const)("the %s has no flat role claim", (_name, claims) => {
    expect(claims).not.toHaveProperty("role");
  });

  test.each([
    ["convex-jwt-template.json", convexTemplateSource],
    ["session-token.json", sessionTokenSource],
  ] as const)("%s never reads client-writable metadata", (_name, source) => {
    expect(source).not.toMatch(/unsafe_metadata|unsafeMetadata/);
  });
});
