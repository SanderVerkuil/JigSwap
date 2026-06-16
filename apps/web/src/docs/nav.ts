import type { DocPage, NavGroup, NavTree, Pager } from "./types";

// Pages for a locale, falling back to the English page for any slug missing in
// that locale. One entry per unique slug. Contract: English is the complete set
// of slugs (every translated locale is a subset) — a page that exists ONLY in a
// non-en locale won't surface, since en seeds the slug list.
export function pagesForLocale(pages: DocPage[], locale: string): DocPage[] {
  const bySlug = new Map<string, DocPage>();
  for (const p of pages) if (p.locale === "en") bySlug.set(p.slug, p);
  if (locale !== "en")
    for (const p of pages) if (p.locale === locale) bySlug.set(p.slug, p);
  return [...bySlug.values()];
}

// Group leaf pages by their group dir. The group's title/order come from the
// group's index page; leaves are sorted by frontmatter.order then title.
export function buildNavTree(pages: DocPage[]): NavTree {
  const groupIndex = new Map<string, DocPage>();
  const leaves = new Map<string, DocPage[]>();

  for (const p of pages) {
    if (p.group === "") continue; // root index is not a nav group
    if (p.isIndex) {
      groupIndex.set(p.group, p);
      if (!leaves.has(p.group)) leaves.set(p.group, []);
    } else {
      const arr = leaves.get(p.group) ?? [];
      arr.push(p);
      leaves.set(p.group, arr);
    }
  }

  const groups: NavGroup[] = [];
  for (const [slug, idx] of groupIndex) {
    const links = (leaves.get(slug) ?? [])
      .slice()
      .sort(byOrderThenTitle)
      .map((p) => ({
        title: p.frontmatter.title,
        slug: p.slug,
        order: p.frontmatter.order ?? 0,
      }));
    groups.push({
      title: idx.frontmatter.title,
      slug,
      order: idx.frontmatter.order ?? 0,
      links,
    });
  }
  return groups.sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

export function flattenOrder(tree: NavTree): string[] {
  return tree.flatMap((g) => g.links.map((l) => l.slug));
}

export function buildPager(tree: NavTree, slug: string): Pager {
  const order = flattenOrder(tree);
  const titleFor = (s: string) => {
    for (const g of tree)
      for (const l of g.links) if (l.slug === s) return l.title;
    return s;
  };
  const i = order.indexOf(slug);
  if (i === -1) return { prev: null, next: null };
  const prev =
    i > 0 ? { slug: order[i - 1], title: titleFor(order[i - 1]) } : null;
  const next =
    i < order.length - 1
      ? { slug: order[i + 1], title: titleFor(order[i + 1]) }
      : null;
  return { prev, next };
}

function byOrderThenTitle(a: DocPage, b: DocPage): number {
  return (
    (a.frontmatter.order ?? 0) - (b.frontmatter.order ?? 0) ||
    a.frontmatter.title.localeCompare(b.frontmatter.title)
  );
}
