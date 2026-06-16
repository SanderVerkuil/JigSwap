import { Container } from "@/components/marketing/container";
import { PageHero } from "@/components/marketing/page-hero";
import { Section } from "@/components/marketing/section";
import { buildNavTree } from "@/docs/nav";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { pages } from "virtual:docs";

export const Route = createFileRoute("/_public/docs/")({
  component: DocsIndex,
});

function DocsIndex() {
  const tree = buildNavTree(pages);
  // Each group's blurb comes from its index page frontmatter summary.
  const summaryFor = (slug: string) =>
    pages.find((p) => p.slug === slug && p.isIndex)?.frontmatter.summary ?? "";

  return (
    <div>
      <PageHero
        eyebrow="Documentation"
        title="JigSwap User Guide"
        lead="Everything you need to build your library, log solves, and swap puzzles with the community."
      />
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
                  <BookOpen className="size-5" />
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
