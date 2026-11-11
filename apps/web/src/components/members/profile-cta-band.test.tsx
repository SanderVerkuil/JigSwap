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

const classesOf = (el: Element) => attr(el, "class")?.split(" ") ?? [];

// The brand variant is the only marigold one; a Persuade page's one marigold action is at the
// public size (50px, 10px radius, 18px/700).
const expectBrandButton = (link: Element) => {
  expect(attr(link, "data-slot")).toBe("button");
  expect(classesOf(link)).toEqual(
    expect.arrayContaining([
      "bg-jigsaw-gold",
      "rounded-[10px]",
      "text-[18px]",
      "font-bold",
    ]),
  );
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

  // The street's closing call to action (the home page's FinalCTA): the statement on sky, on the
  // public 40px edge, with no icon and no rule above it.
  it("closes the page like the street does", () => {
    const html = withIntl(<ProfileCtaBand returnToHref="/members/hans" />);
    const band = parseFragment(html).childNodes.find(isElement)!;
    expect(classesOf(band)).toContain("bg-mk-sky");
    expect(classesOf(band)).not.toContain("border-t");
    const row = band.childNodes.find(isElement)!;
    expect(classesOf(row)).toEqual(
      expect.arrayContaining(["px-4", "min-[760px]:px-10"]),
    );
    expect(html).not.toContain("<svg");
    const h2 = row.childNodes.find(
      (n): n is Element => isElement(n) && n.tagName === "h2",
    )!;
    expect(classesOf(h2)).toEqual(
      expect.arrayContaining([
        "font-mk-heading",
        "text-[clamp(32px,4.4vw,68px)]",
        "font-normal",
      ]),
    );
  });

  // One marigold action per Persuade page: the hero's Follow steps down to outline, and the private
  // card's sign-up is the marigold one.
  it("keeps one marigold action on a private profile: Follow is outline", () => {
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
      expect(attr(link, "data-redirect")).toBe("/members/hans");
    }
    const [follow, cardCta] = links;
    expect(
      follow!.childNodes.map((n) => ("value" in n ? n.value : "")),
    ).toEqual([en.members.profile.follow]);
    expect(classesOf(follow!)).not.toContain("bg-jigsaw-gold");
    expect(classesOf(follow!)).toContain("border");
    expectBrandButton(cardCta!);
    // Its Dutch label takes two lines on a phone; it stays at least 50px, on touch too (the base's
    // 44px coarse-pointer floor would otherwise win over min-h-[50px]).
    expect(classesOf(cardCta!)).toEqual(
      expect.arrayContaining([
        "min-h-[50px]",
        "pointer-coarse:min-h-[50px]",
        "whitespace-normal",
      ]),
    );
    expect(classesOf(cardCta!)).not.toContain("pointer-coarse:min-h-11");
  });
});
