import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { buildNavTree, pagesForLocale } from "@/docs/nav";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";

export const Route = createFileRoute("/_public/docs/")({
  component: DocsIndex,
});

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
      <PageHero title={t("landingTitle")} lead={t("landingLead")} />
      <Section>
        <Container>
          <div className="grid grid-cols-2 gap-x-[clamp(32px,5vw,72px)] gap-y-11 max-[760px]:grid-cols-1">
            {tree.map((group) => (
              <section key={group.slug}>
                <h2 className="font-mk-heading text-[26px] leading-[1.2] font-normal">
                  <Link
                    // Typed router Link carries the splat param, unlike @/compat/link.
                    to="/docs/$"
                    params={{ _splat: group.links[0]?.slug ?? group.slug }}
                    className="text-mk-text-strong hover:decoration-mk-text-strong underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-150"
                  >
                    {group.title}
                  </Link>
                </h2>
                <p className="text-mk-text-body mt-2 max-w-[56ch] text-[17px] leading-relaxed">
                  {summaryFor(group.slug)}
                </p>
                <ul className="mt-3 flex flex-col gap-1">
                  {group.links.map((link) => (
                    <li key={link.slug}>
                      <Link
                        to="/docs/$"
                        params={{ _splat: link.slug }}
                        className="text-mk-text-strong text-[16px] underline decoration-mk-input-border underline-offset-3 transition-[text-decoration-color] duration-150 hover:decoration-mk-text-strong"
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
