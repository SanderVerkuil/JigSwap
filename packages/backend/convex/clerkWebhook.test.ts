import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

// Bundle every Convex module for the in-memory test runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

describe("clerk users webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("responds 503 when CLERK_WEBHOOK_SECRET is unset (env-less preview deployment)", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", undefined);
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(503);
  });

  test("responds 400 when the secret is set but the signature is invalid", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SECRET", "whsec_dGVzdHNlY3JldA==");
    const t = convexTest(schema, modules);
    const response = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(400);
  });
});
