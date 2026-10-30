import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// The Clerk subject -> member lookup belongs to the identity context (SEC-53). Only identity/
// (requireMember, optionalActingMember and friends, which refuse a deactivated account),
// users.ts (the Clerk webhook's own row upkeep) and schema.ts (the index itself) may name the
// `by_clerk_id` index. Any other module resolves the caller through requireMember or
// optionalActingMember, so a hand-rolled lookup can't skip the isActive check again.

const ALLOWED = new Set(["users.ts", "schema.ts"]);

describe("Clerk identity lookups", () => {
  test("only the identity context reads the by_clerk_id index", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "_generated" || name === "node_modules") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
          const file = relative(root, path).split(sep).join("/");
          if (ALLOWED.has(file) || file.startsWith("identity/")) continue;
          if (readFileSync(path, "utf8").includes("by_clerk_id")) {
            offenders.push(file);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
