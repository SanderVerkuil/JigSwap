import { DocBreadcrumb } from "@/components/docs/doc-breadcrumb";
import { DocContent } from "@/components/docs/doc-content";
import { DocHelpful } from "@/components/docs/doc-helpful";
import { DocPager } from "@/components/docs/doc-pager";
import { OnPageToc } from "@/components/docs/on-page-toc";
import { MarketingNotFoundContent } from "@/components/NotFound";
import {
  buildNavTree,
  buildPager,
  findDocPage,
  pagesForLocale,
} from "@/docs/nav";
import { pageTitle } from "@/lib/page-title";
import { seoHead } from "@/lib/seo-head";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";
import { pageLoaders } from "virtual:docs/content";

export const Route = createFileRoute("/_public/docs/$")({
  // The loader rides in the component's lazy chunk: TanStack leaves loaders in
  // the route tree (the entry chunk) by default, which would put the docs
  // metadata on every page of the app. That is also why its docs imports may be
  // static: head() and the rest of the route's eager code never touch them.
  codeSplitGroupings: [["loader", "component"]],
  // Resolving the page in the loader makes an unknown slug a real 404 (status
  // included) rather than a 200 rendering a not-found message, and hands head()
  // the page's own title and summary.
  // Only this page's body is fetched (its own chunk); the nav comes from the
  // shared page metadata. SSR carries the body in the dehydrated loader data, so
  // hydration fetches nothing extra.
  loader: async ({ params, context }) => {
    // Group index pages are pages too; a locale without the page shows English.
    const page = findDocPage(
      pagesForLocale(pages, context.intl.locale),
      params._splat,
    );
    const load = page && pageLoaders[page.id];
    if (!page || !load) throw notFound();
    const { html, headings } = await load();
    return { page, html, headings };
  },
  head: ({ loaderData, match }) =>
    loaderData
      ? seoHead(match, "docs", {
          title: `${loaderData.page.frontmatter.title} — JigSwap`,
          description: loaderData.page.frontmatter.summary,
        })
      : { meta: [{ title: pageTitle(match.context, "notFound") }] },
  // Inside the docs layout, which already provides <main>.
  notFoundComponent: () => <MarketingNotFoundContent />,
  component: DocPageView,
});

function DocPageView() {
  const t = useTranslations("marketing.docs");
  const locale = useLocale();
  const localePages = useMemo(() => pagesForLocale(pages, locale), [locale]);
  const { page, html, headings } = Route.useLoaderData();
  const slug = page.slug;

  const tree = buildNavTree(localePages);
  const pager = buildPager(tree, slug);
  const group = tree.find((g) => g.slug === page.group);

  // A group's own index page ends the trail itself, so it isn't listed twice; elsewhere the group
  // links to its index page where it has one.
  const groupCrumbs =
    group && group.slug !== slug
      ? [
          findDocPage(localePages, group.slug)
            ? { title: group.title, to: `/docs/${group.slug}` }
            : { title: group.title },
        ]
      : [];
  const trail = [
    { title: t("breadcrumbRoot"), to: "/docs" },
    ...groupCrumbs,
    { title: page.frontmatter.title },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_220px] max-[1280px]:grid-cols-1 gap-x-[clamp(24px,3vw,56px)] items-start">
      <article className="max-w-[72ch] min-w-0">
        <DocBreadcrumb trail={trail} />
        <h1 className="font-mk-heading font-normal tracking-[-0.01em] text-mk-text-strong text-[clamp(30px,4vw,44px)] leading-[1.1] mb-5 text-balance">
          {page.frontmatter.title}
        </h1>
        {/* Where the rail beside the text doesn't fit, the same list folds in here. */}
        <OnPageToc
          headings={headings}
          variant="details"
          className="mb-8 min-[1280px]:hidden"
        />
        <DocContent html={html} />
        <DocPager pager={pager} />
        <DocHelpful slug={slug} />
      </article>
      {/* Scrolls on its own when a long article's list is taller than the window, ending above
          the cookie banner while that is open. */}
      <OnPageToc
        headings={headings}
        className="max-[1280px]:hidden sticky top-[96px] max-h-[calc(100dvh-96px-var(--consent-banner-height,0px))] overflow-y-auto overscroll-contain -mx-1 px-1 pb-6 [scrollbar-color:var(--mk-input-border)_transparent] [scrollbar-width:thin]"
      />
    </div>
  );
}
