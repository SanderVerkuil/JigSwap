import { describe, expect, it } from "vitest";
import { buildNavTree, buildPager, flattenOrder } from "./nav";
import type { DocPage } from "./types";

function page(
  slug: string,
  group: string,
  isIndex: boolean,
  title: string,
  order = 0,
): DocPage {
  return {
    slug,
    group,
    isIndex,
    frontmatter: { title, order },
    html: "",
    headings: [],
    text: "",
  };
}

const PAGES: DocPage[] = [
  page("", "", true, "User Guide", 0),
  page("getting-started", "getting-started", true, "Getting Started", 1),
  page(
    "getting-started/accounts-and-sign-in",
    "getting-started",
    false,
    "Accounts",
    1,
  ),
  page(
    "getting-started/finding-your-way-around",
    "getting-started",
    false,
    "Finding Your Way",
    2,
  ),
  page("your-library", "your-library", true, "Your Library", 2),
  page("your-library/collections", "your-library", false, "Collections", 1),
];

describe("buildNavTree", () => {
  it("groups leaf pages under their group, ordered, excluding the root index", () => {
    const tree = buildNavTree(PAGES);
    expect(tree.map((g) => g.title)).toEqual([
      "Getting Started",
      "Your Library",
    ]);
    expect(tree[0].links.map((l) => l.title)).toEqual([
      "Accounts",
      "Finding Your Way",
    ]);
    expect(tree[0].slug).toBe("getting-started");
  });
});

describe("buildPager", () => {
  it("returns prev/next across the flattened reading order", () => {
    const tree = buildNavTree(PAGES);
    const order = flattenOrder(tree);
    expect(order).toEqual([
      "getting-started/accounts-and-sign-in",
      "getting-started/finding-your-way-around",
      "your-library/collections",
    ]);
    const pager = buildPager(tree, "getting-started/finding-your-way-around");
    expect(pager.prev?.slug).toBe("getting-started/accounts-and-sign-in");
    expect(pager.next?.slug).toBe("your-library/collections");
  });

  it("has null prev at the start and null next at the end", () => {
    const tree = buildNavTree(PAGES);
    expect(
      buildPager(tree, "getting-started/accounts-and-sign-in").prev,
    ).toBeNull();
    expect(buildPager(tree, "your-library/collections").next).toBeNull();
  });
});
