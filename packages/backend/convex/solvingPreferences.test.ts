import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

const seedUser = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

describe("settings.getMyUserSettings", () => {
  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await expect(
      t.query(api.settings.getMyUserSettings.getMyUserSettings, {}),
    ).rejects.toThrow("Unauthenticated");
  });

  test("returns the solving section with undefined duration before it is set", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    const settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBeUndefined();
  });
});

describe("solving.setTrackCompletionDuration", () => {
  test("upserts the preference; the federated read reflects it; one row only", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t);
    await asAlice(t).mutation(
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: true },
    );
    let settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBe(true);

    await asAlice(t).mutation(
      api.solving.setTrackCompletionDuration.setTrackCompletionDuration,
      { enabled: false },
    );
    settings = await asAlice(t).query(
      api.settings.getMyUserSettings.getMyUserSettings,
      {},
    );
    expect(settings.solving.trackCompletionDuration).toBe(false);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("solvingPreferences").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
