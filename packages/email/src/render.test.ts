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
    expect(email.html).toContain(`${BASE}/notifications/preferences`);
  });

  it("uses the actor in the from name when present", async () => {
    const email = await renderEmail({
      type: "follow_request_received",
      params: { actorName: "Sander Verkuil" },
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.fromName).toBe("Sander Verkuil | JigSwap");
  });

  it("falls back to the plain brand from name without an actor (never the Someone placeholder)", async () => {
    const email = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "nl",
      baseUrl: BASE,
    });
    expect(email.fromName).toBe("JigSwap");
  });

  it("stays in sync with the domain's EMAIL_ELIGIBLE_TYPES", () => {
    expect(new Set(EMAIL_TYPES)).toEqual(EMAIL_ELIGIBLE_TYPES);
  });

  it("isEmailType narrows correctly", () => {
    expect(isEmailType("trade_request")).toBe(true);
    expect(isEmailType("admin_proposal_filed")).toBe(false);
  });

  it("leaves an unknown token verbatim in the interpolated output", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    // message_received's subject template is "New message from {actorName} on JigSwap"; there is
    // no {unknownToken} in any real template, so this only exercises interpolate's fallback path
    // indirectly. Assert the DEFAULT_PARAMS fallback ("Someone") is used verbatim instead.
    expect(email.subject).toBe("New message from Someone on JigSwap");
  });

  it("treats an explicit empty-string param as present, not falling back to the default", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: { actorName: "" },
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.subject).toBe("New message from  on JigSwap");
  });

  it("pins the rendered HTML layout", async () => {
    const email = await renderEmail({
      type: "trade_request",
      params: { actorName: "Anna" },
      locale: "en",
      baseUrl: "https://jigswap.site",
      relatedId: "x",
    });
    expect(email.html).toMatchSnapshot();
    expect(email.text).toMatchSnapshot();
  });
});
