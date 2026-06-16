import { DocBreadcrumb } from "@/components/docs/doc-breadcrumb";
import { DocContent } from "@/components/docs/doc-content";
import { DocHelpful } from "@/components/docs/doc-helpful";
import { DocPager } from "@/components/docs/doc-pager";
import { OnPageToc } from "@/components/docs/on-page-toc";
import { buildNavTree, buildPager } from "@/docs/nav";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { pages } from "virtual:docs";

export const Route = createFileRoute("/_public/docs/$")({
  component: DocPageView,
});

function DocPageView() {
  const t = useTranslations("marketing.docs");
  const { _splat } = Route.useParams();
  const slug = (_splat ?? "").replace(/\/$/, "");
  const page =
    pages.find((p) => p.slug === slug && !p.isIndex) ??
    pages.find((p) => p.slug === slug); // allow group index pages too
  if (!page) throw notFound();

  const tree = buildNavTree(pages);
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
