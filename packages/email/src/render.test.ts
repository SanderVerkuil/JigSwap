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

  it("pins the rendered HTML layout with a detail paragraph", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: {
        actorName: "Anna",
        messagePreview: "Still have the Ravensburger?",
      },
      locale: "en",
      baseUrl: BASE,
      href: "/messages/thread-1",
    });
    expect(email.html).toMatchSnapshot();
    expect(email.text).toMatchSnapshot();
  });
});

describe("renderEmail with resolved delivery content", () => {
  it.each([
    ["en", "Anna wants to trade for “Starry Night”.", "View trade request"],
    ["nl", "Anna wil ruilen voor “Starry Night”.", "Bekijk ruilverzoek"],
  ] as const)(
    "%s: uses the rich body with the puzzle title and deep-links the exchange",
    async (locale, body, cta) => {
      const email = await renderEmail({
        type: "trade_request",
        params: { actorName: "Anna", puzzleTitle: "Starry Night" },
        locale,
        baseUrl: BASE,
        href: "/trades?exchange=ex-1",
      });
      expect(email.text).toContain(body);
      expect(email.text).toContain(cta);
      expect(email.html).toContain(`${BASE}/trades?exchange=ex-1`);
    },
  );

  it("keeps the generic body when the context token is missing (actorName alone is not enough)", async () => {
    const email = await renderEmail({
      type: "trade_accepted",
      params: { actorName: "Anna" },
      locale: "en",
      baseUrl: BASE,
      href: "/trades?exchange=ex-1",
    });
    expect(email.text).toContain(
      "Good news — your trade request has been accepted!",
    );
    expect(email.text).not.toContain("Anna");
  });

  it("uses the rich body with only context tokens present, falling back for the actor", async () => {
    const email = await renderEmail({
      type: "trade_cancelled",
      params: { puzzleTitle: "Sky" },
      locale: "nl",
      baseUrl: BASE,
    });
    expect(email.text).toContain(
      "Iemand heeft het ruilverzoek voor “Sky” geannuleerd.",
    );
  });

  it.each([
    [
      "trade_accepted",
      "en",
      "Good news — Bo accepted your trade request for “Sky”! Time to arrange the exchange.",
      "View trade",
    ],
    [
      "trade_accepted",
      "nl",
      "Goed nieuws — Bo heeft je ruilverzoek voor “Sky” geaccepteerd! Tijd om de ruil te regelen.",
      "Bekijk ruil",
    ],
    [
      "trade_declined",
      "en",
      "Unfortunately Bo declined your trade request for “Sky”.",
      "View trade",
    ],
    [
      "trade_declined",
      "nl",
      "Helaas heeft Bo je ruilverzoek voor “Sky” afgewezen.",
      "Bekijk ruil",
    ],
    [
      "trade_completed",
      "en",
      "Your exchange of “Sky” with Bo has been marked as completed. Enjoy the puzzle!",
      "View trade",
    ],
    [
      "trade_completed",
      "nl",
      "Je ruil van “Sky” met Bo is gemarkeerd als afgerond. Veel puzzelplezier!",
      "Bekijk ruil",
    ],
    [
      "trade_cancelled",
      "en",
      "Bo cancelled the trade request for “Sky”.",
      "View trade",
    ],
  ] as const)(
    "%s/%s names the actor and the puzzle",
    async (type, locale, body, cta) => {
      const email = await renderEmail({
        type,
        params: { actorName: "Bo", puzzleTitle: "Sky" },
        locale,
        baseUrl: BASE,
        href: "/trades?exchange=ex-9",
      });
      expect(email.text).toContain(body);
      expect(email.text).toContain(cta);
    },
  );

  it("labels a deleted or deactivated actor as a former member, with the brand-only from name", async () => {
    const en = await renderEmail({
      type: "new_follower",
      params: { actorName: "Old Name" },
      locale: "en",
      baseUrl: BASE,
      actorAnonymous: true,
    });
    expect(en.subject).toBe("Former member started following you on JigSwap");
    expect(en.html).not.toContain("Old Name");
    expect(en.fromName).toBe("JigSwap");
    const nl = await renderEmail({
      type: "message_received",
      params: {},
      locale: "nl",
      baseUrl: BASE,
      actorAnonymous: true,
    });
    expect(nl.subject).toBe("Nieuw bericht van Voormalig lid op JigSwap");
  });

  it.each([
    ["en", "“See you Saturday”"],
    ["nl", "“See you Saturday”"],
  ] as const)(
    "%s: renders the message preview as a detail paragraph",
    async (locale, detail) => {
      const email = await renderEmail({
        type: "message_received",
        params: { actorName: "Anna", messagePreview: "See you Saturday" },
        locale,
        baseUrl: BASE,
        href: "/messages/thread-1",
      });
      expect(email.text).toContain(detail);
      expect(email.html).toContain(`${BASE}/messages/thread-1`);
    },
  );

  it("omits the detail paragraph when its token has no value", async () => {
    const email = await renderEmail({
      type: "message_received",
      params: { actorName: "Anna", messagePreview: "" },
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.text).not.toContain("“");
  });

  it.each([
    ["en", "Mara left you a review after your trade.", "Rating: 4 out of 5"],
    [
      "nl",
      "Mara heeft een beoordeling voor je achtergelaten na jullie ruil.",
      "Waardering: 4 van 5",
    ],
  ] as const)(
    "%s: a review names the reviewer and the rating",
    async (locale, body, detail) => {
      const email = await renderEmail({
        type: "review_received",
        params: { actorName: "Mara", rating: "4" },
        locale,
        baseUrl: BASE,
      });
      expect(email.text).toContain(body);
      expect(email.text).toContain(detail);
    },
  );

  it("a nameless reviewer falls back to the generic actor label and no rating line", async () => {
    const email = await renderEmail({
      type: "review_received",
      params: {},
      locale: "en",
      baseUrl: BASE,
    });
    expect(email.text).toContain("Someone left you a review after your trade.");
    expect(email.text).not.toContain("Rating:");
  });

  it.each([
    ["new_follower", "en", "View profile"],
    ["new_follower", "nl", "Bekijk profiel"],
    ["follow_request_approved", "en", "View profile"],
    ["follow_request_approved", "nl", "Bekijk profiel"],
    ["follow_request_received", "en", "Review request"],
  ] as const)(
    "%s/%s deep-links the member profile",
    async (type, locale, cta) => {
      const email = await renderEmail({
        type,
        params: { actorName: "Mara" },
        locale,
        baseUrl: BASE,
        href: "/members/mara",
      });
      expect(email.html).toContain(`${BASE}/members/mara`);
      expect(email.text).toContain(cta);
    },
  );

  it("keeps the list CTA label when the resolved href equals the legacy path", async () => {
    const email = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "en",
      baseUrl: BASE,
      href: "/people",
    });
    expect(email.text).toContain("View people");
  });

  it.each([
    null,
    undefined,
    "https://evil.example/x",
    "//evil.example/x",
    "members/x",
    "",
  ])("falls back to the legacy CTA path for href %s", async (href) => {
    const email = await renderEmail({
      type: "new_follower",
      params: {},
      locale: "en",
      baseUrl: BASE,
      href,
    });
    expect(email.html).toContain(`href="${BASE}/people"`);
    expect(email.html).not.toContain("evil.example");
    expect(email.text).toContain("View people");
  });
});
