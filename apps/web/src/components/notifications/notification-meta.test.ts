import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  EMAIL_ELIGIBLE_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
  notificationCopy,
  type NotificationCopySource,
} from "./notification-meta";

describe("NOTIFICATION_CATEGORIES", () => {
  it("covers every notification type exactly once", () => {
    const all = NOTIFICATION_CATEGORIES.flatMap((c) => c.types);
    expect(all.sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("household notifications", () => {
  it("are social notifications", () => {
    const social = NOTIFICATION_CATEGORIES.find((c) => c.key === "social");
    for (const type of [
      "household_invite_received",
      "household_invite_accepted",
    ] as const) {
      expect(social?.types).toContain(type);
    }
  });
});

describe("whats_new notifications", () => {
  it("are their own product category", () => {
    const product = NOTIFICATION_CATEGORIES.find((c) => c.key === "product");
    expect(product?.types).toEqual(["whats_new"]);
  });

  it("are never emailed", () => {
    expect(EMAIL_ELIGIBLE_TYPES.has("whats_new")).toBe(false);
  });
});

describe("notificationCopy", () => {
  const translator = (locale: "en" | "nl") => {
    const t = createTranslator({
      locale,
      messages: locale === "en" ? en : nl,
      namespace: "notifications",
    });
    return (key: string, values?: Record<string, string>) =>
      (t as (k: string, v?: Record<string, string>) => string)(key, values);
  };
  const row = (
    type: string,
    params?: Record<string, string>,
  ): NotificationCopySource => ({ type, params });
  const message = (
    locale: "en" | "nl",
    type: string,
    params?: Record<string, string>,
  ) => notificationCopy(row(type, params), translator(locale)).message;

  it("names the actor when the row carries actorName", () => {
    expect(message("en", "new_follower", { actorName: "Mara" })).toBe(
      "Mara started following you.",
    );
    expect(message("nl", "new_follower", { actorName: "Mara" })).toBe(
      "Mara volgt je nu.",
    );
    expect(message("en", "trade_request", { actorName: "Mara" })).toBe(
      "Mara wants to trade for one of your puzzles.",
    );
    expect(
      message("nl", "household_invite_accepted", { actorName: "Mara" }),
    ).toBe("Mara is lid geworden van je huishouden.");
  });

  it("falls back to the generic sentence when a param is missing or blank", () => {
    expect(message("en", "new_follower")).toBe(
      "Someone started following you.",
    );
    expect(message("en", "new_follower", { actorName: "  " })).toBe(
      "Someone started following you.",
    );
    expect(message("nl", "new_follower", {})).toBe("Iemand volgt je nu.");
    expect(message("en", "goal_achieved")).toBe(
      "You reached one of your goals!",
    );
    expect(message("nl", "puzzle_approved")).toBe(
      "Je puzzelinzending is goedgekeurd.",
    );
  });

  it("interpolates puzzle and goal titles", () => {
    expect(message("en", "goal_achieved", { goalTitle: "100 puzzles" })).toBe(
      "You reached your goal “100 puzzles”!",
    );
    expect(
      message("nl", "puzzle_rejected", { puzzleTitle: "Sterrennacht" }),
    ).toBe("Je puzzelinzending “Sterrennacht” is afgewezen.");
  });

  it("appends the reject reason only when present", () => {
    expect(
      message("en", "proposal_rejected", {
        puzzleTitle: "Sterrennacht",
        reason: "Duplicate",
      }),
    ).toBe(
      "Your suggested edit to “Sterrennacht” was declined. Reason: Duplicate",
    );
    expect(
      message("nl", "proposal_rejected", { puzzleTitle: "Sterrennacht" }),
    ).toBe("Jouw voorgestelde wijziging aan “Sterrennacht” is afgewezen.");
    expect(message("en", "proposal_rejected")).toBe(
      "Your suggested edit was declined.",
    );
  });

  it.each(["en", "nl"] as const)(
    "%s never prints a raw key, undefined or null, with or without params",
    (locale) => {
      const full = {
        actorName: "Mara",
        puzzleTitle: "Sterrennacht",
        goalTitle: "100 puzzles",
        reason: "Duplicate",
      };
      for (const type of NOTIFICATION_TYPES) {
        for (const params of [undefined, full]) {
          const copy = notificationCopy(row(type, params), translator(locale));
          for (const text of [copy.title, copy.message]) {
            expect(text, type).not.toMatch(/copy\.|undefined|null|[{}]/);
            expect(text.length, type).toBeGreaterThan(0);
          }
        }
      }
    },
  );
});

describe("notifications locale parity", () => {
  const keys = (obj: object, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" && v !== null
        ? keys(v as object, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    );

  it("en, nl and source define the same notification keys", () => {
    const enKeys = keys(en.notifications).sort();
    expect(keys(nl.notifications).sort()).toEqual(enKeys);
    expect(keys(source.notifications).sort()).toEqual(enKeys);
  });

  it("source mirrors en for the notification copy", () => {
    expect(source.notifications.copy).toEqual(en.notifications.copy);
    expect(source.notifications.rich).toEqual(en.notifications.rich);
  });
});
