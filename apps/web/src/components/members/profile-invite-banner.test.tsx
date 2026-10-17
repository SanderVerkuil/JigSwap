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
