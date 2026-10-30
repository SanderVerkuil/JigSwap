import { createTranslator } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { MODERATION_ACTIVITY_KINDS } from "./activity-log";

type ActivityMessageKey = keyof typeof en.admin.moderation.activity;

vi.mock("@/gateway", () => ({ gateway: {} }));

// Every audit-trail kind the Activity Log knows (KIND_META, exhaustive over the backend's
// moderationActions kinds) reads as a sentence in both languages: a kind added to the schema but
// missing from a locale would otherwise render as a raw message key.
describe("moderation activity messages", () => {
  it.each([
    ["en", en],
    ["nl", nl],
  ] as const)(
    "every kind has a %s message naming the actor",
    (locale, messages) => {
      const errors: string[] = [];
      const t = createTranslator({
        locale,
        messages,
        namespace: "admin.moderation.activity",
        onError: (error) => errors.push(error.message),
      });
      for (const kind of MODERATION_ACTIVITY_KINDS) {
        const sentence = t.markup(kind as ActivityMessageKey, {
          actor: "Ada",
          target: "Mountain Vista",
          strong: (chunks) => chunks,
        });
        expect(sentence, kind).toContain("Ada");
        expect(sentence, kind).not.toContain("admin.moderation");
      }
      expect(errors).toEqual([]);
    },
  );

  it("covers the admin writes stamped since SEC-56", () => {
    expect(MODERATION_ACTIVITY_KINDS).toEqual(
      expect.arrayContaining([
        "photo_recheck_requested",
        "category_created",
        "category_updated",
        "category_deactivated",
        "category_reactivated",
        "categories_reordered",
        "contact_message_handled",
      ]),
    );
  });
});
