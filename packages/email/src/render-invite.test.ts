import { describe, expect, it } from "vitest";
import { INVITE_COPY, INVITE_KINDS } from "./invite-copy";
import { renderInviteEmail } from "./render-invite";

const URL = "https://accounts.jigswap.site/v1/tickets/accept?ticket=tkt_1";

describe("renderInviteEmail", () => {
  it("renders both kinds in both locales with the CTA and the inviter", async () => {
    for (const kind of INVITE_KINDS) {
      for (const locale of ["en", "nl"] as const) {
        const email = await renderInviteEmail({
          kind,
          locale,
          inviterName: "Anna",
          ctaUrl: URL,
        });
        const label = `${kind}/${locale}`;
        expect(email.subject, label).toContain("Anna");
        expect(email.html, label).toContain("JigSwap");
        expect(email.html, label).toContain(URL.replace("&", "&amp;"));
        expect(email.html, label).toContain(INVITE_COPY[kind][locale].cta);
        expect(email.text, label).toContain(URL);
        expect(email.text, label).not.toContain("{inviterName}");
        expect(email.html, label).not.toContain("{inviterName}");
      }
    }
  });

  it("states the purpose: following each other, or joining a household", async () => {
    const follow = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(follow.subject).toBe("Anna invited you to JigSwap");
    expect(follow.text).toContain(
      "Anna invited you to JigSwap to follow each other.",
    );
    const household = await renderInviteEmail({
      kind: "household",
      locale: "nl",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(household.subject).toBe(
      "Anna nodigt je uit voor hun huishouden op JigSwap",
    );
    expect(household.text).toContain(
      "Anna nodigt je uit voor JigSwap om lid te worden van hun huishouden.",
    );
  });

  it("names the inviter in the footer and says nothing is kept", async () => {
    const en = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(en.text).toContain(
      "Anna invited you with this email address. If you ignore this email, nothing more happens: JigSwap keeps no copy of your address",
    );
    const nl = await renderInviteEmail({
      kind: "follow",
      locale: "nl",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(nl.text).toContain("Anna heeft je met dit e-mailadres uitgenodigd.");
    expect(nl.text).toContain("JigSwap bewaart je adres niet");
  });

  it("carries the inviter in the From name", async () => {
    const email = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(email.fromName).toBe("Anna | JigSwap");
  });

  it("falls back to a generic label without an inviter name", async () => {
    for (const inviterName of [undefined, ""]) {
      const en = await renderInviteEmail({
        kind: "follow",
        locale: "en",
        inviterName,
        ctaUrl: URL,
      });
      expect(en.subject).toBe("A JigSwap member invited you to JigSwap");
      expect(en.fromName).toBe("JigSwap");
      const nl = await renderInviteEmail({
        kind: "household",
        locale: "nl",
        inviterName,
        ctaUrl: URL,
      });
      expect(nl.subject).toBe(
        "Een JigSwap-lid nodigt je uit voor hun huishouden op JigSwap",
      );
      expect(nl.fromName).toBe("JigSwap");
    }
  });

  it("escapes the inviter name in the HTML", async () => {
    const email = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: '<a href="https://evil.example">Anna</a>',
      ctaUrl: URL,
    });
    expect(email.html).not.toContain('<a href="https://evil.example">');
    expect(email.html).toContain("&lt;a href=");
  });

  it("has no preferences link (the recipient has no account)", async () => {
    const email = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(email.html).not.toContain("/notifications/preferences");
  });

  it("pins the rendered layout", async () => {
    const email = await renderInviteEmail({
      kind: "follow",
      locale: "en",
      inviterName: "Anna",
      ctaUrl: URL,
    });
    expect(email.html).toMatchSnapshot();
    expect(email.text).toMatchSnapshot();
  });

  it("pins the copy", () => {
    expect(INVITE_COPY).toMatchSnapshot();
  });
});
