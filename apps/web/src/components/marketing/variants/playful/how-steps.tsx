import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Reveal } from "@/components/marketing/reveal";
import { Section, SectionHead } from "@/components/marketing/section";
import * as React from "react";

type Step = {
  num: string;
  title: string;
  body: string;
  active?: boolean;
  motif: React.ReactNode;
};

// Small playful piece arrangement per card (decorative).
function StepMotif({
  pieces,
}: {
  pieces: Array<[string, number, number, number]>;
}) {
  return (
    <div
      aria-hidden="true"
      className="relative mb-5"
      style={{ width: 76, height: 64 }}
    >
      {pieces.map(([color, size, x, y], i) => (
        <PieceMotif
          key={i}
          size={size}
          color={color}
          rotate={i * 18 - 18}
          style={{ position: "absolute", left: x, top: y }}
        />
      ))}
    </div>
  );
}

const STEPS: Step[] = [
  {
    num: "01",
    title: "Fill your shelf",
    body: "Add every box you own to your personal puzzle library — covers, piece counts and all.",
    active: true,
    motif: (
      <StepMotif
        pieces={[
          ["var(--mk-violet-400)", 44, 0, 8],
          ["var(--mk-violet-200)", 30, 36, 24],
        ]}
      />
    ),
  },
  {
    num: "02",
    title: "Discover & request",
    body: "Browse what the community's sharing and ask to borrow or swap.",
    motif: (
      <StepMotif
        pieces={[
          ["var(--mk-green-400)", 42, 2, 6],
          ["var(--mk-green-200)", 30, 38, 26],
        ]}
      />
    ),
  },
  {
    num: "03",
    title: "Lend & track",
    body: "Hand a puzzle on and always see who's got it and when it's coming back.",
    motif: (
      <StepMotif
        pieces={[
          ["var(--mk-violet-400)", 40, 4, 8],
          ["var(--mk-pink-400)", 28, 38, 24],
        ]}
      />
    ),
  },
];

function StepCard({ step, delay }: { step: Step; delay: number }) {
  return (
    <Reveal delay={delay}>
      <article className="v-lift h-full bg-mk-card border border-mk-border shadow-mk-sm rounded-[var(--v-radius-card)] p-[clamp(20px,3vw,32px)]">
        <div
          className="inline-flex items-center justify-center font-mk-heading font-bold text-[15px] w-10 h-10 rounded-[var(--v-radius-chip)] mb-4"
          style={{
            background: step.active
              ? "color-mix(in oklab, var(--mk-pink-400) 16%, var(--mk-card))"
              : "var(--mk-muted)",
            color: step.active ? "var(--mk-pink-500)" : "var(--mk-text-strong)",
          }}
        >
          {step.num}
        </div>
        {step.motif}
        <h3 className="font-mk-heading font-bold text-mk-text-strong text-[clamp(19px,2vw,22px)] leading-tight">
          {step.title}
        </h3>
        <p className="mt-2 text-[15px] leading-relaxed text-mk-text-muted text-pretty">
          {step.body}
        </p>
      </article>
    </Reveal>
  );
}

export function HowSteps() {
  return (
    <Section>
      <Container>
        <SectionHead
          align="center"
          eyebrow="How it works"
          title="Three steps and you're swapping."
          lead="Build your shelf, find your next puzzle, and keep track of every box you lend out."
        />
        <div className="mt-[clamp(36px,5vw,56px)] grid gap-[clamp(20px,2.5vw,32px)] grid-cols-3 max-[860px]:grid-cols-1">
          {STEPS.map((step, i) => (
            <StepCard key={step.num} step={step} delay={i * 90} />
          ))}
        </div>
      </Container>
    </Section>
  );
}
