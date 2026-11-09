import { useShortcutHint } from "@/components/dashboard-layout/shortcut-hint";
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
      <PageHero title={t("landingTitle")} lead={t("landingLead")}>
        <DocsHeroSearch />
      </PageHero>
      <Section>
        <Container>
          <div className="grid grid-cols-2 gap-x-[clamp(32px,5vw,72px)] gap-y-11 max-[760px]:grid-cols-1">
            {tree.map((group) => (
              <section key={group.slug}>
                <Link
                  // Typed router Link carries the splat param, unlike @/compat/link.
                  to="/docs/$"
                  params={{ _splat: group.links[0]?.slug ?? group.slug }}
                  className="group block w-fit"
                >
                  <div className="bg-mk-sky-soft dark:bg-mk-muted text-mk-text-strong mb-3 grid size-11 place-items-center rounded-md">
                    <GroupIcon slug={group.slug} />
                  </div>
                  <h2 className="font-mk-heading text-mk-text-strong group-hover:decoration-mk-text-strong text-[26px] leading-[1.2] font-normal underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-150">
                    {group.title}
                  </h2>
                </Link>
                <p className="text-mk-text-body mt-2 max-w-[56ch] text-[17px] leading-relaxed">
                  {summaryFor(group.slug)}
                </p>
                {/* On touch screens each link is a 44px row. */}
                <ul className="mt-3 flex flex-col gap-1 pointer-coarse:gap-0">
                  {group.links.map((link) => (
                    <li key={link.slug}>
                      <Link
                        to="/docs/$"
                        params={{ _splat: link.slug }}
                        className="text-mk-text-strong inline-flex items-center text-[16px] underline decoration-mk-input-border underline-offset-3 transition-[text-decoration-color] duration-150 hover:decoration-mk-text-strong pointer-coarse:min-h-11"
                      >
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
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
  const shortcut = useShortcutHint();
  if (!openSearch) return null;
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      className="bg-mk-card border-mk-input-border text-mk-text-muted hover:border-mk-ring/60 hover:text-mk-text-body focus-visible:border-mk-ring focus-visible:ring-mk-ring/50 flex h-12 w-full max-w-[520px] cursor-pointer items-center gap-3 rounded-md border px-4 text-left text-[16px] transition-colors duration-150 outline-none focus-visible:ring-[3px]"
    >
      <Search className="size-[18px] shrink-0" aria-hidden="true" />
      <span>{t("searchTrigger")}</span>
      {/* Known only after mount; touch screens have no keyboard to press it with. */}
      {shortcut && (
        <kbd
          aria-hidden="true"
          className="text-mk-text-body ml-auto font-sans text-[14px] max-md:hidden pointer-coarse:hidden"
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
