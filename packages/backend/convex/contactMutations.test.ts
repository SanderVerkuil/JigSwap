import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob("./**/!(*.test).*s");

describe("contact/submitContactMessage", () => {
  test("persists a valid message as new, trimmed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.contact.submitContactMessage.submitContactMessage, {
      name: "  Mara  ",
      email: " mara@example.com ",
      subject: "swap",
      message: "  I'd love to swap my 1000-piece forest puzzle.  ",
      locale: "nl",
    });

    const rows = await t.run((ctx) => ctx.db.query("contactMessages").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Mara",
      email: "mara@example.com",
      subject: "swap",
      message: "I'd love to swap my 1000-piece forest puzzle.",
      locale: "nl",
      status: "new",
    });
    expect(rows[0].createdAt).toBeGreaterThan(0);
  });

  test.each([
    ["empty name", { name: "   " }],
    ["bad email", { email: "not-an-email" }],
    ["short message", { message: "too short" }],
    ["oversized message", { message: "x".repeat(5001) }],
  ])("rejects %s", async (_label, override) => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.contact.submitContactMessage.submitContactMessage, {
        name: "Mara",
        email: "mara@example.com",
        subject: "other",
        message: "A perfectly reasonable message.",
        ...override,
      }),
    ).rejects.toThrow(ConvexError);

    const rows = await t.run((ctx) => ctx.db.query("contactMessages").collect());
    expect(rows).toHaveLength(0);
  });
});
