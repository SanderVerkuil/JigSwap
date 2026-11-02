import { contentWidthClass } from "@/components/dashboard-layout/content-width";
import { PuzzleViewProvider } from "@/components/puzzles/puzzle-view-provider";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { ProfileBody, type PublicProfileView } from "./profile-body";
import { ProfilePuzzlesSection } from "./profile-listings";

// Router-free Link: the test asserts layout classes, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));

// One page of two visible copies; no network.
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: [{ _id: "c1" }, { _id: "c2" }],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));

// Stub the card (its own rendering is covered elsewhere); keep the real grid provider.
vi.mock("@/components/ui/puzzle-card", async () => ({
  PuzzleViewProvider: (
    await import("@/components/puzzles/puzzle-view-provider")
  ).PuzzleViewProvider,
  PuzzleCard: () => <article />,
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
const classOf = (el: Element) =>
  el.attrs.find((a) => a.name === "class")?.value ?? "";
const classes = (el: Element) => classOf(el).split(/\s+/);

const withIntl = (node: ReactNode) =>
  renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      {node}
    </IntlProvider>,
  );

// A locked profile renders only the hero + private card, so no queries are needed.
const lockedProfile = {
  locked: true,
  hero: {
    memberId: "member1",
    displayName: "Hans",
    username: "hans",
    handle: "hans",
    memberSince: Date.UTC(2024, 0, 1),
    visibility: "private",
    followerCount: 0,
    followingCount: 0,
    reviewCount: 0,
    rating: 0,
  },
} as unknown as PublicProfileView;

const rootOf = (viewer: "public" | "owner") =>
  elementsOf(
    withIntl(<ProfileBody profile={lockedProfile} viewer={viewer} />),
  )[0];

describe("profile page width", () => {
  it("shares the shell's regular-width column", () => {
    expect(contentWidthClass(true)).toBeUndefined();
    expect(contentWidthClass(false)).toBe("mx-auto max-w-[1180px]");
  });

  it("uses the regular column for the logged-out page (no preferences)", () => {
    const root = classes(rootOf("public"));
    expect(root).toEqual(
      expect.arrayContaining(contentWidthClass(false)!.split(" ")),
    );
    expect(root).not.toContain("max-w-3xl");
  });

  it("defers to the dashboard shell's width preference when signed in", () => {
    const root = classes(rootOf("owner"));
    expect(root).not.toContain("max-w-[1180px]");
    expect(root).not.toContain("max-w-3xl");
    expect(root).toContain("w-full");
  });

  it("pads only the logged-out page; the dashboard shell already pads signed-in viewers", () => {
    expect(classes(rootOf("public"))).toEqual(
      expect.arrayContaining(["px-4", "py-10"]),
    );
    const signedIn = classes(rootOf("owner"));
    expect(signedIn).not.toContain("px-4");
    expect(signedIn).not.toContain("py-10");
  });

  it("fits two puzzle cards per row on phones and auto-fills 212px columns from sm", () => {
    const grid = classOf(
      elementsOf(
        renderToStaticMarkup(
          <PuzzleViewProvider viewMode="grid">{null}</PuzzleViewProvider>,
        ),
      )[0],
    ).split(/\s+/);
    expect(grid).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-2",
        "sm:grid-cols-[repeat(auto-fill,minmax(212px,1fr))]",
      ]),
    );
    // The auto-fill template must not apply below sm: at ~358px it fits one column.
    expect(grid).not.toContain(
      "grid-cols-[repeat(auto-fill,minmax(212px,1fr))]",
    );
  });

  it("lays puzzle cards out directly in the shared puzzle grid", () => {
    const sharedGrid = classOf(
      elementsOf(
        renderToStaticMarkup(
          <PuzzleViewProvider viewMode="grid">{null}</PuzzleViewProvider>,
        ),
      )[0],
    );
    const html = withIntl(
      <ProfilePuzzlesSection
        memberId={"member1" as never}
        firstName="Hans"
        scope="available"
      />,
    );
    const grids = elementsOf(html).filter((el) =>
      el.childNodes.some((c) => isElement(c) && c.tagName === "article"),
    );
    expect(grids).toHaveLength(1);
    expect(classOf(grids[0])).toBe(sharedGrid);
    expect(
      grids[0].childNodes.filter(
        (c) => isElement(c) && c.tagName === "article",
      ),
    ).toHaveLength(2);
  });
});

// The hero sits beside the dashboard sidebar, so a viewport breakpoint says
// nothing about the room it actually has (an 820px tablet leaves it ~510px).
// happy-dom/SSR has no layout, so this pins the class contract; the geometry
// was checked in a browser at 390, 820 and 1440px.
describe("profile hero layout", () => {
  const heroProfile = {
    ...lockedProfile,
    hero: { ...lockedProfile.hero, location: "Leusden, Nederland" },
  } as PublicProfileView;
  const heroElements = () =>
    elementsOf(withIntl(<ProfileBody profile={heroProfile} viewer="public" />));
  const textOf = (el: Element): string =>
    el.childNodes
      .map((c) =>
        isElement(c) ? textOf(c) : "value" in c ? String(c.value) : "",
      )
      .join("");
  const metaItem = (text: string) =>
    heroElements().find(
      (el) =>
        el.tagName === "span" &&
        classes(el).includes("inline-flex") &&
        textOf(el).includes(text),
    );

  it("switches to a row on its own container width, not the viewport", () => {
    const hero = heroElements().find((el) => el.tagName === "section")!;
    expect(textOf(hero)).toContain("Hans");
    expect(classes(hero)).toContain("@2xl/hero:flex-row");
    expect(classOf(hero)).not.toMatch(/(^|\s)(sm|md|lg):flex-row/);
    expect(classes(hero.parentNode as Element)).toContain("@container/hero");
  });

  it("wraps a long name, handle or location inside the identity column", () => {
    const h1 = heroElements().find((el) => el.tagName === "h1")!;
    expect(classes(h1)).toContain("[overflow-wrap:anywhere]");
    expect(classes(metaItem("hans")!)).toContain("[overflow-wrap:anywhere]");
    expect(classes(metaItem("Leusden, Nederland")!)).toContain(
      "[overflow-wrap:anywhere]",
    );
  });
});
