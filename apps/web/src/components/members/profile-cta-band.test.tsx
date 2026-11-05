import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import {
  ProfileBody,
  ProfileCtaBand,
  type PublicProfileView,
} from "./profile-body";

// A router-free Link that, like the real one, forwards every anchor prop
// (className, data-slot, ref) to the <a>, so Button asChild styling shows up.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    params: _params,
    ...rest
  }: ComponentProps<"a"> & {
    to: string;
    params?: unknown;
    search?: { redirect_url?: string };
    children?: ReactNode;
  }) => (
    <a href={to} data-redirect={search?.redirect_url} {...rest}>
      {children}
    </a>
  ),
}));

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const isElement = (node: Node): node is Element => "tagName" in node;
const anchorsOf = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.tagName === "a") out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const signUpLinks = (html: string) =>
  anchorsOf(html).filter((a) => attr(a, "href") === "/sign-up/$");

const withIntl = (node: ReactNode) =>
  renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      {node}
    </IntlProvider>,
  );

// The brand variant is the only one carrying the brand glow.
const expectBrandButton = (link: Element) => {
  expect(attr(link, "data-slot")).toBe("button");
  expect(attr(link, "class")?.split(" ")).toContain("bg-jigsaw-gold");
};

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

describe("logged-out profile sign-up CTAs", () => {
  it("renders the bottom band's Sign up free as a brand button", () => {
    const links = signUpLinks(
      withIntl(<ProfileCtaBand returnToHref="/members/hans?invite=abc" />),
    );
    expect(links).toHaveLength(1);
    expectBrandButton(links[0]!);
    expect(attr(links[0]!, "data-redirect")).toBe("/members/hans?invite=abc");
  });

  it("renders the hero Follow and the private card CTA as brand buttons", () => {
    const links = signUpLinks(
      withIntl(
        <ProfileBody
          profile={lockedProfile}
          viewer="public"
          returnToHref="/members/hans"
        />,
      ),
    );
    expect(links).toHaveLength(2);
    for (const link of links) {
      expectBrandButton(link);
      expect(attr(link, "data-redirect")).toBe("/members/hans");
    }
  });
});
