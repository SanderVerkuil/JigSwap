import { Container } from "@/components/marketing/container";
import { TEXT_LINK } from "@/components/marketing/home/classes";
import { Section } from "@/components/marketing/section";
import { isPlainClick, useActiveHeading } from "@/hooks/use-active-heading";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
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
  action?: React.ReactNode; // a control shown after the text (e.g. Cookie settings)
}

// Shared legal document layout: sticky table of contents with scroll-spy beside a reading column at a
// comfortable measure (a collapsible Contents block below 900px). Section numbers stay because legal
// text is cited by section.
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
  const [active, pick] = useActiveHeading(sections);
  const contentsRef = React.useRef<HTMLDetailsElement>(null);

  return (
    <Section>
      <Container>
        <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-[clamp(32px,5vw,72px)] max-[900px]:grid-cols-1">
          {/* Scrolls on its own where the list is taller than the window (a laptop, in Dutch),
              ending above the cookie banner while that is open. */}
          <aside className="sticky top-24 -mx-1 max-h-[calc(100dvh-96px-var(--consent-banner-height,0px))] self-start overflow-y-auto overscroll-contain px-1 pb-6 [scrollbar-color:var(--mk-input-border)_transparent] [scrollbar-width:thin] max-[900px]:hidden">
            <div className="font-mk-heading text-mk-text-strong mb-3 text-[18px]">
              {t("contents")}
            </div>
            <LegalToc sections={sections} active={active} onPick={pick} />
          </aside>
          <div className="max-w-[70ch]">
            <p className="text-mk-text-muted mb-5 text-[15px]">{updated}</p>
            <p className="text-mk-text-body text-[18px] leading-[1.65]">
              {intro}
            </p>
            {/* Below 900px the sticky list above is hidden; the same links
                fold into a Contents block at the top of the text. */}
            <details
              id="contents"
              ref={contentsRef}
              className="group bg-mk-muted dark:bg-mk-card mt-6 scroll-mt-2.5 rounded-md min-[901px]:hidden"
            >
              <summary className="font-mk-heading text-mk-text-strong focus-visible:ring-mk-ring flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 text-[18px] font-normal focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                {t("contents")}
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div className="px-4 pb-3">
                <LegalToc sections={sections} active={active} onPick={pick} />
              </div>
            </details>
            {sections.map((s, i) => (
              // Lands 90px down: the page's scroll-padding clears the header (80px) and this adds 10.
              <section key={s.id} id={s.id} className="scroll-mt-2.5 pt-11">
                {/* Lining figures: Young Serif's old-style 11 reads as II. */}
                <h2 className="font-mk-heading text-mk-text-strong mb-3.5 text-[clamp(24px,2.4vw,30px)] leading-[1.2] font-normal lining-nums">
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
                {s.action && <div className="mb-3.5">{s.action}</div>}
                {/* On phones the contents sit only at the top of a very long page. */}
                <a
                  href="#contents"
                  onClick={() => {
                    if (contentsRef.current) contentsRef.current.open = true;
                  }}
                  className={cn(
                    TEXT_LINK,
                    "text-mk-text-muted hover:text-mk-text-strong inline-flex min-h-11 items-center text-[15px] min-[901px]:hidden",
                  )}
                >
                  {t("backToContents")}
                </a>
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

// The contents list: plain #hash links, so every section has a URL to share
// and the browser does the jump (the page's scroll-padding clears the header).
// A picked section is marked current straight away.
function LegalToc({
  sections,
  active,
  onPick,
}: {
  sections: LegalSection[];
  active: string | undefined;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("marketing.legal");
  return (
    <nav aria-label={t("contents")} className="flex flex-col gap-0.5">
      {sections.map((s, i) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => {
            if (isPlainClick(e)) onPick(s.id);
          }}
          aria-current={active === s.id ? "true" : undefined}
          className={cn(
            "rounded-sm px-2.5 py-[6px] text-[14px] leading-snug transition-colors duration-150",
            active === s.id
              ? "bg-mk-sky-soft dark:bg-mk-muted text-mk-text-strong font-semibold"
              : "text-mk-text-muted hover:text-mk-text-strong font-medium",
          )}
        >
          {i + 1}. {s.heading}
        </a>
      ))}
    </nav>
  );
}
