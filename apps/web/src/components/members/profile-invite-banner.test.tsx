import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";

// Router-free Link: these tests assert the invite banners, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const isElement = (node: Node): node is Element => "tagName" in node;
const elementsOf = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};
const textOf = (el: Element): string =>
  el.childNodes
    .map((n) =>
      "value" in n && n.nodeName === "#text"
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");
const texts = (html: string) => elementsOf(html).map(textOf);

// A locked profile renders only the hero + private card, so no queries are needed.
const lockedProfile = {
  locked: true,
  hero: {
    memberId: "member1",
    displayName: "Hans",
    username: "hans",
    memberSince: Date.UTC(2024, 0, 1),
    visibility: "private",
    followerCount: 0,
    followingCount: 0,
    reviewCount: 0,
    rating: 0,
  },
} as unknown as PublicProfileView;

const render = (
  props: Partial<Parameters<typeof ProfileBody>[0]>,
  locale: "en" | "nl" = "en",
) =>
  renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <ProfileBody profile={lockedProfile} viewer="public" {...props} />
    </IntlProvider>,
  );

describe("invite landing banners", () => {
  it("keeps the network invitation banner", () => {
    const all = texts(render({ invitedName: "Hans" }));
    expect(all).toContain("Hans invited you to JigSwap");
    expect(all.join("\n")).not.toContain("household");
  });

  it("frames a household link as an invitation to choose after sign-up", () => {
    const all = texts(
      render({ invitedName: "Hans", invitedKind: "household" }),
    );
    expect(all).toContain(
      "Hans invited you to join their household on JigSwap",
    );
    expect(all).toContain(
      "Sign up first. You'll then choose whether to join; nothing is shared until you accept.",
    );
  });

  it("says an expired or used link is dead, in Dutch too", () => {
    expect(texts(render({ inviteExpired: true }))).toContain(
      "This invite link has expired or was already used.",
    );
    expect(texts(render({ inviteExpired: true }, "nl"))).toContain(
      "Deze uitnodigingslink is verlopen of al gebruikt.",
    );
  });

  it("shows nothing invite-related without an invite", () => {
    const all = texts(render({})).join("\n");
    expect(all).not.toContain("invited you");
    expect(all).not.toContain("expired");
  });
});

// SEC-44 locks a member who never chose a visibility for logged-out viewers, and so a referred
// newcomer lands on this card. It must say what will happen, and the same for every locked member:
// a live invite always ends in a connection offer (redeemInvite), whatever the inviter chose.
describe("the locked card for a logged-out visitor", () => {
  const WRONG = /private|approved|request/i;
  const WRONG_NL = /privé|goedgekeurd|volgverzoek/i;
  // Every word on the page outside the hero's own "Follow" and the banner.
  const page = (
    props: Partial<Parameters<typeof ProfileBody>[0]>,
    locale: "en" | "nl" = "en",
  ) => texts(render(props, locale)).join("\n");

  it("tells a referred newcomer what happens after sign-up, and promises no approval", () => {
    const all = page({ invitedName: "Hans" });
    expect(all).toContain(
      "Sign up to see what Hans shares. We'll then ask whether you two want to follow each other, and nothing happens until you say yes.",
    );
    expect(all).toContain("Sign up to follow each other");
    expect(all).not.toMatch(WRONG);
  });

  it("says the same in natural Dutch", () => {
    const all = page({ invitedName: "Hans" }, "nl");
    expect(all).toContain(
      "Meld je aan om te zien wat Hans deelt. Daarna vragen we of jullie elkaar willen volgen, en er gebeurt niets tot je ja zegt.",
    );
    expect(all).toContain("Meld je aan om elkaar te volgen");
    expect(all).not.toMatch(WRONG_NL);
  });

  it("leaves a household invitation to its banner, without a follow request", () => {
    const all = page({ invitedName: "Hans", invitedKind: "household" });
    expect(all).toContain("Sign up free");
    expect(all).not.toContain("follow each other");
    expect(all).not.toMatch(WRONG);
    expect(
      page({ invitedName: "Hans", invitedKind: "household" }, "nl"),
    ).not.toMatch(WRONG_NL);
  });

  it("makes no claim about the member's choice without an invite: SEC-44 hides it", () => {
    const all = page({});
    expect(all).toContain(
      "Visitors without an account can't see Hans's puzzles, completions and story. Sign up to follow them.",
    );
    expect(all).toContain("Sign up to follow");
    expect(all).not.toMatch(WRONG);
    expect(page({}, "nl")).not.toMatch(WRONG_NL);
  });

  it("reads the same for a dead household link as for no invite at all", () => {
    const body = (html: string) =>
      elementsOf(html)
        .filter((el) => el.tagName === "p")
        .map(textOf)
        .filter((line) => line.startsWith("Visitors without"));
    expect(body(render({ inviteExpired: true }))).toEqual(body(render({})));
  });
});

describe("the private profile's wording in Dutch", () => {
  it("doesn't read as someone else's puzzles", () => {
    expect(nl.members.profile.privateBody).not.toMatch(/\bhun\b/);
  });
});
