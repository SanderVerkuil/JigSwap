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

export const Route = createFileRoute("/_public/docs/$")({
  // Resolving the page in the loader makes an unknown slug a real 404 (status included) rather than
  // a 200 rendering a not-found message, and hands head() the page's own title and summary. The
  // docs bundle is imported lazily so it stays out of the route's eagerly loaded code; the
  // component chunk imports it anyway. Every slug the prerender crawl reaches exists, so the crawl
  // never meets this 404.
  loader: async ({ params, context }) => {
    const docs = await import("virtual:docs");
    const page = findDocPage(
      pagesForLocale(docs.pages, context.intl.locale),
      params._splat,
    );
    if (!page) throw notFound();
    return {
      title: page.frontmatter.title,
      summary: page.frontmatter.summary,
    };
  },
  head: ({ loaderData, match }) =>
    loaderData
      ? seoHead(match, "docs", {
          title: `${loaderData.title} — JigSwap`,
          description: loaderData.summary,
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
  const { _splat } = Route.useParams();
  const page = findDocPage(localePages, _splat);
  if (!page) throw notFound(); // the loader already 404s; this narrows the type
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
        <DocContent html={page.html} />
        <DocPager pager={pager} />
        <DocHelpful slug={slug} />
      </article>
      <OnPageToc
        headings={page.headings}
        className="max-[1280px]:hidden sticky top-[96px]"
      />
    </div>
  );
}
