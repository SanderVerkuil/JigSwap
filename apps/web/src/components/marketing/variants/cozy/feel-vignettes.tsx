import { Container } from "@/components/marketing/container";
import { Reveal } from "@/components/marketing/reveal";
import { Section, SectionHead } from "@/components/marketing/section";
import * as React from "react";
import { PhotoFallback } from "./photo-fallback";

type Vignette = {
  title: string;
  caption: string;
  photo: string;
  icon: React.ReactNode;
};

// Tiny decorative line-icons (inline SVG, currentColor → terracotta via ramp).
const shelfIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
    <rect
      x="5"
      y="2.5"
      width="3"
      height="3.5"
      rx="0.7"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="14"
      y="8.5"
      width="3"
      height="3.5"
      rx="0.7"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);
const shareIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path
      d="M4 12a4 4 0 0 1 4-4h3M20 12a4 4 0 0 1-4 4h-3"
      strokeLinecap="round"
    />
    <path
      d="M9 9l-3 3 3 3M15 9l3 3-3 3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const pinIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path
      d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);

const VIGNETTES: Vignette[] = [
  {
    title: "Fill your shelf",
    caption:
      "Add your boxes one cozy evening at a time. Your whole collection, in one warm place.",
    photo: "hands sorting puzzle boxes on a shelf, warm light",
    icon: shelfIcon,
  },
  {
    title: "Share & borrow",
    caption:
      "Lend a finished puzzle, borrow one you've been eyeing. Sharing beats hoarding.",
    photo: "a puzzle box passed between two people at a table",
    icon: shareIcon,
  },
  {
    title: "Always know where it is",
    caption: "Lent it out? You'll always know whose table it's on.",
    photo: 'a phone showing "who has my box", cozy desk',
    icon: pinIcon,
  },
];

function VignetteCard({ v }: { v: Vignette }) {
  return (
    <article className="cozy-lift bg-mk-card border-mk-border shadow-mk-md flex h-full flex-col overflow-hidden rounded-[var(--mk-radius-card)] border">
      <PhotoFallback label={v.photo} className="aspect-[5/4] w-full" />
      <div className="flex flex-1 flex-col p-6">
        <span className="text-mk-violet-600 mb-3 inline-flex h-9 w-9 items-center justify-center">
          {v.icon}
        </span>
        <h3 className="font-mk-heading text-mk-text-strong text-[20px] font-semibold tracking-tight">
          {v.title}
        </h3>
        <p className="text-mk-text-body mt-2 text-[15px] leading-relaxed text-pretty">
          {v.caption}
        </p>
      </div>
    </article>
  );
}

// Section 3 — "How sharing feels": the share loop as three gentle, unhurried
// vignettes. Reveal staggers them; reduced-motion users get them already shown.
export function FeelVignettes() {
  return (
    <Section>
      <Container>
        <SectionHead
          eyebrow="How sharing feels"
          title="Three small, unhurried steps."
        />
        <div className="mt-10 grid grid-cols-3 gap-[clamp(20px,3vw,32px)] max-[860px]:grid-cols-1 max-[860px]:gap-6">
          {VIGNETTES.map((v, i) => (
            <Reveal key={v.title} delay={i * 90}>
              <VignetteCard v={v} />
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
