import { Container } from "@/components/marketing/container";
import { Section } from "@/components/marketing/section";
import { cn } from "@/lib/utils";
import { Calendar } from "lucide-react";
import * as React from "react";
import { useTranslations } from "use-intl";

// One content block inside a legal section.
export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "strong"; text: string } // emphasised paragraph (e.g. "we never sell your data")
  | { type: "sub"; text: string } // sub-heading within a section
  | { type: "list"; items: string[] };

export interface LegalSection {
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

// Shared legal document layout: sticky table of contents with scroll-spy
// beside a 720px reading column. Ported from the design handoff's LegalDoc.
export function LegalDoc({
  updated,
  intro,
  sections,
  children,
}: {
  updated: string;
  intro: string;
  sections: LegalSection[];
  children?: React.ReactNode; // trailing contact note
}) {
  const t = useTranslations("marketing.legal");
  const [active, setActive] = React.useState(sections[0]?.id);

  React.useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el)
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - 90,
        behavior: "smooth",
      });
  };

  return (
    <Section>
      <Container>
        <div className="grid grid-cols-[240px_1fr] max-[900px]:grid-cols-1 gap-[clamp(32px,5vw,72px)] items-start">
          <aside className="sticky top-24 self-start max-[900px]:hidden">
            <div className="font-mono text-[11px] font-bold tracking-[.1em] uppercase text-mk-text-muted mb-3.5">
              {t("contents")}
            </div>
            <nav className="flex flex-col gap-0.5 border-l border-mk-border">
              {sections.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jump(s.id)}
                  className={cn(
                    "text-left cursor-pointer py-[7px] px-3.5 -ml-px border-l-2 text-[13.5px] leading-snug transition-colors",
                    active === s.id
                      ? "border-mk-violet-400 text-mk-violet-600 font-semibold"
                      : "border-transparent text-mk-text-muted font-medium hover:text-mk-text-body",
                  )}
                >
                  {i + 1}. {s.heading}
                </button>
              ))}
            </nav>
          </aside>
          <div className="max-w-[720px]">
            <div className="flex items-center gap-2.5 text-[13.5px] text-mk-text-muted mb-6">
              <Calendar size={15} />
              {updated}
            </div>
            <p className="text-[16.5px] leading-[1.7] text-mk-text-body mb-2">
              {intro}
            </p>
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-[90px] pt-9">
                <h2 className="font-mk-heading font-bold tracking-tight text-2xl text-mk-text-strong mb-3.5">
                  {i + 1}. {s.heading}
                </h2>
                {s.blocks.map((b, j) => {
                  switch (b.type) {
                    case "sub":
                      return (
                        <h3
                          key={j}
                          className="font-mk-heading font-semibold text-lg text-mk-text-strong mt-5 mb-2.5"
                        >
                          {b.text}
                        </h3>
                      );
                    case "list":
                      return (
                        <ul
                          key={j}
                          className="mb-3.5 pl-[22px] list-disc flex flex-col gap-2"
                        >
                          {b.items.map((li) => (
                            <li
                              key={li}
                              className="text-[15.5px] leading-relaxed text-mk-text-muted"
                            >
                              {li}
                            </li>
                          ))}
                        </ul>
                      );
                    case "strong":
                      return (
                        <p
                          key={j}
                          className="text-[15.5px] leading-[1.7] font-medium text-mk-text-body mb-3.5"
                        >
                          {b.text}
                        </p>
                      );
                    default:
                      return (
                        <p
                          key={j}
                          className="text-[15.5px] leading-[1.7] text-mk-text-muted mb-3.5"
                        >
                          {b.text}
                        </p>
                      );
                  }
                })}
              </section>
            ))}
            {children && (
              <div className="mt-12 pt-6 border-t border-mk-border text-[14.5px] text-mk-text-muted">
                {children}
              </div>
            )}
          </div>
        </div>
      </Container>
    </Section>
  );
}
