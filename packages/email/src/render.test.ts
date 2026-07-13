import { EMAIL_ELIGIBLE_TYPES } from "@jigswap/domain";
import { describe, expect, it } from "vitest";
import { EMAIL_TYPES } from "./copy";
import { isEmailType, renderEmail } from "./render";

const BASE = "https://jigswap.site";

describe("renderEmail", () => {
  it("renders every eligible type in both locales", async () => {
    for (const type of EMAIL_TYPES) {
      for (const locale of ["en", "nl"] as const) {
        const email = await renderEmail({
          type,
          params: {},
          locale,
          baseUrl: BASE,
        });
        expect(email.subject.length, `${type}/${locale}`).toBeGreaterThan(0);
        expect(email.html, `${type}/${locale}`).toContain("JigSwap");
        expect(email.text.length, `${type}/${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates params into subject and body", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: { actorName: "Anna" },
      locale: "en",
      baseUrl: BASE,
      relatedId: "thread-1",
    });
    expect(email.subject).toBe("New message from Anna on JigSwap");
    expect(email.html).toContain("Anna");
    expect(email.html).toContain("https://jigswap.site/messages/thread-1");
  });

  it("falls back to a locale-appropriate default for a missing actorName", async () => {
    const en = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    expect(en.subject).toContain("Someone");
    const nl = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "nl",
      baseUrl: BASE,
    });
    expect(nl.subject).toContain("Iemand");
  });

  it("builds the CTA from the base URL and per-type path", async () => {
    const email = await renderEmail({
      type: "trade_request",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.html).toContain(`${BASE}/trades`);
    // Footer always links to notification preferences.
    expect(email.html).toContain(`${BASE}/notifications`);
  });

  it("stays in sync with the domain's EMAIL_ELIGIBLE_TYPES", () => {
    expect(new Set(EMAIL_TYPES)).toEqual(EMAIL_ELIGIBLE_TYPES);
  });

  it("isEmailType narrows correctly", () => {
    expect(isEmailType("trade_request")).toBe(true);
    expect(isEmailType("admin_proposal_filed")).toBe(false);
  });
});
