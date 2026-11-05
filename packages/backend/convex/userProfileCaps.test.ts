import { convexTest, type TestConvex } from "convex-test";
import { ConvexError, type Value } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// SEC-27 (review repro IDENT-1): users.updateUserProfile patched bio, location and
// preferredLanguage straight onto the caller's row with no limits, bypassing setLocation's
// 80-character cap. A 500 KB bio and a 450 KB location were stored and then served to other
// members. The bio argument is gone (profiles.bio is the public bio), location follows
// setLocation's rules, and preferredLanguage is one of the supported locales.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

type T = TestConvex<typeof schema>;

const insertUser = (t: T, name: string, location?: string) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: `clerk_${name}`,
      email: `${name}@example.com`,
      name,
      preferredLanguage: "en",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      ...(location !== undefined ? { location } : {}),
    }),
  );

const asMember = (t: T, who: string) =>
  t.withIdentity({ subject: `clerk_${who}` });

const rowOf = (t: T, id: Id<"users">) => t.run((ctx) => ctx.db.get(id));

// convex-test serializes ConvexError.data to a JSON string at the function boundary; normalise.
const errorDataOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    const data = (error as ConvexError<Value>).data;
    return typeof data === "string" && data.startsWith("{")
      ? JSON.parse(data)
      : data;
  }
  throw new Error("expected the call to reject");
};

describe("users.updateUserProfile caps what it writes (SEC-27)", () => {
  test("the IDENT-1 payload is refused and nothing is stored", async () => {
    const t = convexTest(schema, modules);
    const mallory = await insertUser(t, "mallory");

    expect(
      await errorDataOf(
        asMember(t, "mallory").mutation(api.users.updateUserProfile, {
          location: "B".repeat(450_000),
        }),
      ),
    ).toEqual({ code: "invalid_location" });

    // Not a supported locale: refused by the argument validator.
    const language = { preferredLanguage: "C".repeat(10_000) };
    await expect(
      asMember(t, "mallory").mutation(
        api.users.updateUserProfile,
        // A plain string is wider than the locale union the mutation declares.
        language as { preferredLanguage: "en" },
      ),
    ).rejects.toThrow();

    // users.bio is no longer writable here: an extra argument fails validation.
    const withBio = { location: "Utrecht", bio: "A".repeat(500_000) };
    await expect(
      asMember(t, "mallory").mutation(api.users.updateUserProfile, withBio),
    ).rejects.toThrow();

    const row = await rowOf(t, mallory);
    expect(row?.bio).toBeUndefined();
    expect(row?.location).toBeUndefined();
    expect(row?.preferredLanguage).toBe("en");
  });

  test("a location is trimmed and may be 80 characters but not 81", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann");
    const update = (location: string) =>
      asMember(t, "ann").mutation(api.users.updateUserProfile, { location });

    await update("  Utrecht  ");
    expect((await rowOf(t, ann))?.location).toBe("Utrecht");

    await update(` ${"a".repeat(80)} `);
    expect((await rowOf(t, ann))?.location).toBe("a".repeat(80));

    expect(await errorDataOf(update("a".repeat(81)))).toEqual({
      code: "invalid_location",
    });
    expect((await rowOf(t, ann))?.location).toBe("a".repeat(80));
  });

  test("a supported language is stored and leaves the location alone", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", "Utrecht");

    await asMember(t, "ann").mutation(api.users.updateUserProfile, {
      preferredLanguage: "nl",
    });
    const row = await rowOf(t, ann);
    expect(row?.preferredLanguage).toBe("nl");
    expect(row?.location).toBe("Utrecht");
  });

  test("only the caller's own row changes", async () => {
    const t = convexTest(schema, modules);
    await insertUser(t, "ann");
    const bob = await insertUser(t, "bob", "Leiden");

    await asMember(t, "ann").mutation(api.users.updateUserProfile, {
      location: "Utrecht",
    });
    expect((await rowOf(t, bob))?.location).toBe("Leiden");
  });
});

describe("a location stored before the cap stays editable", () => {
  const LEGACY = "L".repeat(200);

  test("resending it unchanged is accepted, by both write paths", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", LEGACY);

    await asMember(t, "ann").mutation(api.users.updateUserProfile, {
      location: LEGACY,
    });
    await asMember(t, "ann").mutation(api.identity.setLocation.setLocation, {
      location: ` ${LEGACY} `,
    });
    expect((await rowOf(t, ann))?.location).toBe(LEGACY);
  });

  test("a different over-long value is refused", async () => {
    const t = convexTest(schema, modules);
    const ann = await insertUser(t, "ann", LEGACY);

    expect(
      await errorDataOf(
        asMember(t, "ann").mutation(api.users.updateUserProfile, {
          location: `${LEGACY}x`,
        }),
      ),
    ).toEqual({ code: "invalid_location" });
    expect((await rowOf(t, ann))?.location).toBe(LEGACY);
  });
});
