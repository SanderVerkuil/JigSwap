import { useOpenDocsSearch } from "@/components/docs/docs-search-context";
import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { buildNavTree, pagesForLocale } from "@/docs/nav";
import { seoHead } from "@/lib/seo-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  FileText,
  LifeBuoy,
  Rocket,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";

export const Route = createFileRoute("/_public/docs/")({
  head: ({ match }) => seoHead(match, "docs"),
  component: DocsIndex,
});

// One icon per docs group (keyed by its folder), echoing the app's own icons
// where it has one: Library is BookOpen and Swaps ArrowLeftRight in the tab bar.
const GROUP_ICONS: Record<string, LucideIcon> = {
  "getting-started": Rocket,
  "your-library": BookOpen,
  "sharing-and-exchanges": ArrowLeftRight,
  "discovering-and-community": Users,
  "staying-informed": Bell,
  help: LifeBuoy,
};

function DocsIndex() {
  const t = useTranslations("marketing.docs");
  const locale = useLocale();
  const localePages = useMemo(() => pagesForLocale(pages, locale), [locale]);
  const tree = useMemo(() => buildNavTree(localePages), [localePages]);
  // Each group's blurb comes from its index page frontmatter summary.
  const summaryFor = (slug: string) =>
    localePages.find((p) => p.slug === slug && p.isIndex)?.frontmatter
      .summary ?? "";

  return (
    <div>
      <PageHero
        eyebrow={t("landingEyebrow")}
        title={t("landingTitle")}
        lead={t("landingLead")}
      >
        <DocsHeroSearch />
      </PageHero>
      <Section>
        <Container>
          <div className="grid grid-cols-3 max-[860px]:grid-cols-2 max-[540px]:grid-cols-1 gap-6">
            {tree.map((group) => (
              <Link
                key={group.slug}
                // Typed router Link carries the splat param, unlike @/compat/link.
                to="/docs/$"
                params={{ _splat: group.links[0]?.slug ?? group.slug }}
                className="group rounded-[20px] bg-mk-card border border-mk-border p-6 transition-all hover:shadow-mk-md hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
              >
                <div className="grid place-items-center size-11 rounded-[12px] bg-mk-violet-50 text-mk-violet-600 mb-4">
                  <GroupIcon slug={group.slug} />
                </div>
                <h3 className="font-mk-heading font-semibold text-[18px] text-mk-text-strong group-hover:text-mk-violet-600">
                  {group.title}
                </h3>
                <p className="text-[14.5px] text-mk-text-muted mt-1.5">
                  {summaryFor(group.slug)}
                </p>
              </Link>
            ))}
          </div>
        </Container>
      </Section>
    </div>
  );
}

function GroupIcon({ slug }: { slug: string }) {
  const Icon = GROUP_ICONS[slug] ?? FileText;
  return <Icon className="size-5" aria-hidden="true" />;
}

// The landing has no sidebar, so it carries its own visible way into search
// (the dialog and ⌘K live in DocsLayout).
function DocsHeroSearch() {
  const t = useTranslations("marketing.docs");
  const openSearch = useOpenDocsSearch();
  if (!openSearch) return null;
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className="flex items-center gap-3 w-full max-w-[520px] h-12 px-4 rounded-[12px] bg-mk-card border border-mk-border text-mk-text-muted text-base text-left shadow-mk-sm transition-colors hover:border-mk-violet-300 hover:text-mk-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
    >
      <Search className="size-[18px] opacity-70" aria-hidden="true" />
      <span>{t("searchTrigger")}</span>
      <kbd
        aria-hidden="true"
        className="ml-auto max-md:hidden font-mono text-[12px] px-1.5 py-0.5 rounded-[5px] bg-mk-muted border border-mk-border"
      >
        ⌘K
      </kbd>
    </button>
  );
}
