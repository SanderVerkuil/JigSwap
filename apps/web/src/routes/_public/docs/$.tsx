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

  const trail = [
    { title: t("breadcrumbRoot"), to: "/docs" },
    ...(group ? [{ title: group.title }] : []),
    { title: page.frontmatter.title },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_220px] max-[1280px]:grid-cols-1 gap-x-[clamp(24px,3vw,56px)] items-start">
      <article className="max-w-[720px] min-w-0">
        <DocBreadcrumb trail={trail} />
        <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(30px,4vw,40px)] leading-[1.12] mb-4">
          {page.frontmatter.title}
        </h1>
        <DocContent html={html} />
        <DocPager pager={pager} />
        <DocHelpful slug={slug} />
      </article>
      <OnPageToc
        headings={headings}
        className="max-[1280px]:hidden sticky top-[96px]"
      />
    </div>
  );
}
