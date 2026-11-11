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

// One page of two visible copies; no network. A test may empty it.
const paginated = vi.hoisted(() => ({
  results: [{ _id: "c1" }, { _id: "c2" }] as unknown[],
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({
    results: paginated.results,
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
const descendantsOf = (el: Element): Element[] =>
  el.childNodes
    .filter(isElement)
    .flatMap((child) => [child, ...descendantsOf(child)]);
const textOfEl = (el: Element): string =>
  el.childNodes
    .map((c) =>
      isElement(c) ? textOfEl(c) : "value" in c ? String(c.value) : "",
    )
    .join("");

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

// The public page's two rows: the sky band around the hero, then the sections column.
const publicRowsOf = (profile: PublicProfileView) => {
  const root = elementsOf(
    withIntl(<ProfileBody profile={profile} viewer="public" />),
  )[0];
  const [band, column] = root.childNodes.filter(isElement);
  return { root, band, column };
};

const unlockedProfile = (stats: Record<string, number>) =>
  ({
    ...lockedProfile,
    locked: false,
    hero: { ...lockedProfile.hero, visibility: "public" },
    stats,
    records: {},
    currentlySolving: [],
    libraryScope: "available",
  }) as unknown as PublicProfileView;

const NO_STATS = { puzzlesOwned: 0, completions: 0, piecesPlaced: 0, swaps: 0 };

describe("profile page width", () => {
  // DESIGN.md Layout: public text on a 16px margin that becomes 40px at 760px, in full-width bands.
  // The shell's centred column (contentWidthClass) is no longer the logged-out page's.
  it("lays the logged-out page on the public edge, not the shell's column", () => {
    const { root, band, column } = publicRowsOf(lockedProfile);
    for (const cls of contentWidthClass(false)!.split(" ")) {
      expect(classes(root)).not.toContain(cls);
    }
    expect(classes(band)).toContain("bg-mk-sky");
    const bandRow = band.childNodes.find(isElement)!;
    for (const row of [bandRow, column]) {
      expect(classes(row)).toEqual(
        expect.arrayContaining(["px-4", "py-10", "min-[760px]:px-10"]),
      );
      expect(classes(row)).not.toContain("mx-auto");
    }
  });

  it("opens the logged-out page on a sky band carrying the hero", () => {
    const { band, column } = publicRowsOf(lockedProfile);
    expect(descendantsOf(band).some((el) => el.tagName === "h1")).toBe(true);
    expect(descendantsOf(column).some((el) => el.tagName === "h1")).toBe(false);
    // On sky the app's muted grey falls under 4.5:1, so the band reads the street's muted ink.
    expect(classes(band)).toContain(
      "[--muted-foreground:var(--mk-text-muted)]",
    );
  });

  // The 10% green tint over sky is 4.42:1 in light mode, under AA; the visitor's pill is the
  // street's opaque success chip (#14572a on #d9f0de). The shell keeps its tinted pill.
  it("gives the rating pill an opaque street chip on the sky band", () => {
    const rated = {
      ...lockedProfile,
      hero: { ...lockedProfile.hero, reviewCount: 3, rating: 4.7 },
    } as PublicProfileView;
    const pillOf = (viewer: "public" | "owner") =>
      elementsOf(
        withIntl(<ProfileBody profile={rated} viewer={viewer} />),
      ).find(
        (el) =>
          el.tagName === "span" &&
          classes(el).includes("rounded-full") &&
          textOfEl(el).includes("4.7"),
      )!;
    const visitor = classes(pillOf("public"));
    expect(visitor).toEqual(
      expect.arrayContaining(["bg-mk-success-soft", "text-mk-success-strong"]),
    );
    expect(visitor).not.toContain("bg-jigsaw-secondary/10");
    expect(classes(pillOf("owner"))).toEqual(
      expect.arrayContaining([
        "bg-jigsaw-secondary/10",
        "text-jigsaw-secondary-text",
      ]),
    );
  });

  it("defers to the dashboard shell's width preference when signed in", () => {
    const root = classes(rootOf("owner"));
    expect(root).not.toContain("max-w-[1180px]");
    expect(root).not.toContain("max-w-3xl");
    expect(root).toContain("w-full");
  });

  it("pads only the logged-out page; the dashboard shell already pads signed-in viewers", () => {
    const signedIn = rootOf("owner");
    expect(classOf(signedIn)).toBe("flex w-full flex-col gap-10");
    for (const el of elementsOf(
      withIntl(<ProfileBody profile={lockedProfile} viewer="owner" />),
    )) {
      expect(classes(el)).not.toContain("bg-mk-sky");
      expect(classes(el)).not.toContain("min-[760px]:px-10");
    }
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

// A visitor sees what the member has done, as on the catalogue detail; a row of zeros says nothing.
// Members and the owner keep all four figures.
describe("profile stat strip", () => {
  const LABELS = ["puzzles owned", "completions", "pieces placed", "swaps"];
  const labelsShown = (
    profile: PublicProfileView,
    viewer: "public" | "owner",
  ) =>
    LABELS.filter((label) =>
      elementsOf(
        withIntl(<ProfileBody profile={profile} viewer={viewer} />),
      ).some((el) => el.tagName === "div" && textOfEl(el) === label),
    );

  it("shows a visitor only the figures that aren't zero", () => {
    expect(
      labelsShown(unlockedProfile({ ...NO_STATS, puzzlesOwned: 9 }), "public"),
    ).toEqual(["puzzles owned"]);
  });

  it("leaves out the strip, and the empty column, when a visitor would see only zeros", () => {
    const profile = unlockedProfile(NO_STATS);
    expect(labelsShown(profile, "public")).toEqual([]);
    // Nothing below the hero: the column is empty, so its sky neighbours meet.
    const { column } = publicRowsOf(profile);
    expect(column.childNodes).toHaveLength(0);
    expect(classes(column)).toContain("empty:hidden");
  });

  it("keeps all four figures, zeros included, for a signed-in viewer", () => {
    const copies = paginated.results;
    paginated.results = []; // the signed-in listings below the strip stay out of the way
    try {
      expect(labelsShown(unlockedProfile(NO_STATS), "owner")).toEqual(LABELS);
    } finally {
      paginated.results = copies;
    }
  });
});
