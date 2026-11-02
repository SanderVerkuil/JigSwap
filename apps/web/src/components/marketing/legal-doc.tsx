import { Container } from "@/components/marketing/container";
import { Section } from "@/components/marketing/section";
import { cn } from "@/lib/utils";
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

// Shared legal document layout: sticky table of contents with scroll-spy beside a reading column at a
// comfortable measure. Section numbers stay because legal text is cited by section.
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
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  };

  return (
    <Section>
      <Container>
        <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-[clamp(32px,5vw,72px)] max-[900px]:grid-cols-1">
          <aside className="sticky top-24 self-start max-[900px]:hidden">
            <div className="font-mk-heading text-mk-text-strong mb-3 text-[18px]">
              {t("contents")}
            </div>
            <nav className="flex flex-col gap-0.5">
              {sections.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active === s.id ? "true" : undefined}
                  onClick={() => jump(s.id)}
                  className={cn(
                    "cursor-pointer rounded-sm px-2.5 py-[6px] text-left text-[14px] leading-snug transition-colors duration-150",
                    active === s.id
                      ? "bg-mk-sky-soft dark:bg-mk-muted text-mk-text-strong font-semibold"
                      : "text-mk-text-muted hover:text-mk-text-strong font-medium",
                  )}
                >
                  {i + 1}. {s.heading}
                </button>
              ))}
            </nav>
          </aside>
          <div className="max-w-[70ch]">
            <p className="text-mk-text-muted mb-5 text-[15px]">{updated}</p>
            <p className="text-mk-text-body text-[18px] leading-[1.65]">
              {intro}
            </p>
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-[90px] pt-11">
                <h2 className="font-mk-heading text-mk-text-strong mb-3.5 text-[clamp(24px,2.4vw,30px)] leading-[1.2] font-normal">
                  {i + 1}. {s.heading}
                </h2>
                {s.blocks.map((b, j) => {
                  switch (b.type) {
                    case "sub":
                      return (
                        <h3
                          key={j}
                          className="text-mk-text-strong mt-6 mb-2 text-[18px] leading-snug font-semibold"
                        >
                          {b.text}
                        </h3>
                      );
                    case "list":
                      return (
                        <ul
                          key={j}
                          className="marker:text-mk-text-muted mb-4 flex list-disc flex-col gap-2 pl-[22px]"
                        >
                          {b.items.map((li) => (
                            <li
                              key={li}
                              className="text-mk-text-body text-[17px] leading-relaxed"
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
                          className="text-mk-text-strong mb-4 text-[17px] leading-[1.7] font-semibold"
                        >
                          {b.text}
                        </p>
                      );
                    default:
                      return (
                        <p
                          key={j}
                          className="text-mk-text-body mb-4 text-[17px] leading-[1.7]"
                        >
                          {b.text}
                        </p>
                      );
                  }
                })}
              </section>
            ))}
            {children && (
              <div className="text-mk-text-body mt-12 text-[17px] leading-[1.7]">
                {children}
              </div>
            )}
          </div>
        </div>
      </Container>
    </Section>
  );
}
