import { describe, expect, it } from "vitest";
import {
  EMAIL_ELIGIBLE_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  notificationHref,
} from "./notification-meta";

describe("NOTIFICATION_CATEGORIES", () => {
  it("covers every notification type exactly once", () => {
    const all = NOTIFICATION_CATEGORIES.flatMap((c) => c.types);
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("household notifications", () => {
  it("are social notifications that deep-link to the household page", () => {
    const social = NOTIFICATION_CATEGORIES.find((c) => c.key === "social");
    for (const type of [
      "household_invite_received",
      "household_invite_accepted",
    ] as const) {
      expect(social?.types).toContain(type);
      expect(
        notificationHref({
          _id: "n1",
          type,
          isRead: false,
          createdAt: 0,
        }),
      ).toBe("/household");
    }
  });
});

describe("whats_new notifications", () => {
  it("are their own product category", () => {
    const product = NOTIFICATION_CATEGORIES.find((c) => c.key === "product");
    expect(product?.types).toEqual(["whats_new"]);
  });

  it("deep-link to the entry's anchor on /whats-new, else the page", () => {
    const row = { _id: "n1", type: "whats_new", isRead: false, createdAt: 0 };
    expect(notificationHref({ ...row, relatedId: "households" })).toBe(
      "/whats-new#entry-households",
    );
    expect(notificationHref(row)).toBe("/whats-new");
  });

  it("are never emailed", () => {
    expect(EMAIL_ELIGIBLE_TYPES.has("whats_new")).toBe(false);
  });
});
