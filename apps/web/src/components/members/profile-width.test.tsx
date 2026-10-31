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
