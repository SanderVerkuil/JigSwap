import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// SEC-11: toMemberView emits a member's bio, location and preferredLanguage, so it may only reach a
// viewer the privacy rules reveal that member to. Every other surface that shows a member uses the
// chokepoint (social/privacy projectMemberIdentity), a teaser identity (memberTeaserIdentityOf) or
// identity only (toMemberIdentityView). This scan pins the modules allowed to call toMemberView,
// each with the reason it is safe; a new caller fails here until it is projected instead (or
// reviewed and added with its reason).
const ALLOWED: Record<string, string> = {
  "identity/toMemberView.ts":
    "the definition, and toCurrentMemberView (the caller's own view)",
  "social/privacy.ts":
    "projectMemberIdentity: full view only when isRevealedByOrdinaryRules (or self), else identity only or anonymous",
  "conversation/threadMemberProjection.ts":
    "strips bio, location and preferredLanguage before returning (circle co-member reveal)",
  "identity/getUserById.ts":
    "returns null unless self, public, or a mutual follower, and null when blocked by the target",
  "identity/searchUsers.ts":
    "surfaces only self, public profiles and mutual followers, never across a block",
  "identity/getUserByClerkId.ts": "the caller's own record only",
  "identity/listRecentPublicMembers.ts":
    "public, active profiles only, never across a block",
  "exchange/tradeParty.ts":
    "full view only for a party the ordinary rules reveal; a trade-only reveal is trimmed",
};

const root = fileURLToPath(new URL(".", import.meta.url));

// The source with comments and string literals blanked, so a mention in prose or an import path
// ("./toMemberView") is not a use.
const codeOf = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

const callers = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === "_generated" || name === "node_modules") continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
        if (/\btoMemberView\b/.test(codeOf(readFileSync(path, "utf8")))) {
          found.push(relative(root, path).split("\\").join("/"));
        }
      }
    }
  };
  walk(root);
  return found.sort();
};

describe("toMemberView allowlist", () => {
  test("only the allowlisted modules use toMemberView", () => {
    const offenders = callers().filter((path) => !(path in ALLOWED));
    expect(offenders).toEqual([]);
  });

  // A stale entry would silently re-admit a module later; drop it when its caller goes.
  test("every allowlisted module still uses it", () => {
    expect(callers()).toEqual(Object.keys(ALLOWED).sort());
  });
});
