import { createTranslator } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  formatUnreadBadge,
  unreadNotificationsLabel,
  type Translator,
} from "./unread-count";

describe("notification unread count", () => {
  it("shows the exact count up to 99 and 99+ from the backend cap on", () => {
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(99)).toBe("99");
    // notifications/unreadCount stops at 100, so 100 means "100 or more".
    expect(formatUnreadBadge(100)).toBe("99+");
  });

  it("labels the capped count as 99+ in en and nl, and the exact count below it", () => {
    for (const [locale, messages, exact, capped] of [
      ["en", en, "7 unread notifications", "99+ unread notifications"],
      ["nl", nl, "7 ongelezen meldingen", "99+ ongelezen meldingen"],
      ["en", source, "7 unread notifications", "99+ unread notifications"],
    ] as const) {
      const t = createTranslator({
        locale,
        messages,
        namespace: "notifications",
      }) as Translator;
      expect(unreadNotificationsLabel(t, 7)).toBe(exact);
      expect(unreadNotificationsLabel(t, 99)).not.toBe(capped);
      expect(unreadNotificationsLabel(t, 100)).toBe(capped);
    }
  });
});
