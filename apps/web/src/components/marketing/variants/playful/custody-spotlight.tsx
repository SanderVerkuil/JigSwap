import { Container } from "@/components/marketing/container";
import { PieceMotif } from "@/components/marketing/piece-motif";
import { Reveal } from "@/components/marketing/reveal";
import { Eyebrow, Section } from "@/components/marketing/section";
import { Package, RotateCcw, User } from "lucide-react";
import * as React from "react";

// Calm box → person → back-to-you custody diagram. Decorative (aria-hidden);
// the meaning is in the heading + body. Curved connectors are inline SVG.
function Node({ children, tint }: { children: React.ReactNode; tint: string }) {
  return (
    <div
      className="relative z-[1] flex flex-col items-center justify-center rounded-[var(--v-radius-card)] bg-mk-card border border-mk-border shadow-mk-sm"
      style={{
        width: "clamp(74px,18vw,96px)",
        height: "clamp(74px,18vw,96px)",
      }}
    >
      <div
        className="flex items-center justify-center rounded-[14px]"
        style={{
          width: 40,
          height: 40,
          background: tint,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function CustodyDiagram() {
  return (
    <div aria-hidden="true" className="relative w-full">
      {/* Desktop / tablet: horizontal row with curved connectors. */}
      <div className="relative flex items-center justify-center gap-[clamp(20px,4vw,44px)] max-[540px]:hidden">
        <Node tint="color-mix(in oklab, var(--mk-violet-400) 16%, var(--mk-card))">
          <Package size={22} className="text-mk-violet-600" />
        </Node>
        <Connector />
        <Node tint="color-mix(in oklab, var(--mk-green-400) 18%, var(--mk-card))">
          <User size={22} className="text-mk-green-600" />
        </Node>
        <Connector back />
        <Node tint="color-mix(in oklab, var(--mk-pink-400) 16%, var(--mk-card))">
          <RotateCcw size={22} className="text-mk-pink-500" />
        </Node>
        {/* soft floating pieces */}
        <PieceMotif
          size={26}
          color="color-mix(in oklab, var(--mk-violet-200) 70%, transparent)"
          rotate={-16}
          style={{ position: "absolute", top: -18, right: 8 }}
        />
        <PieceMotif
          size={20}
          color="color-mix(in oklab, var(--mk-green-200) 70%, transparent)"
          rotate={22}
          style={{ position: "absolute", bottom: -16, left: 4 }}
        />
      </div>

      {/* 320px: collapse to a vertical box → person → you sequence. */}
      <div className="hidden max-[540px]:flex flex-col items-center gap-3">
        <Node tint="color-mix(in oklab, var(--mk-violet-400) 16%, var(--mk-card))">
          <Package size={22} className="text-mk-violet-600" />
        </Node>
        <span className="text-mk-border text-lg leading-none">↓</span>
        <Node tint="color-mix(in oklab, var(--mk-green-400) 18%, var(--mk-card))">
          <User size={22} className="text-mk-green-600" />
        </Node>
        <span className="text-mk-border text-lg leading-none">↓</span>
        <Node tint="color-mix(in oklab, var(--mk-pink-400) 16%, var(--mk-card))">
          <RotateCcw size={22} className="text-mk-pink-500" />
        </Node>
      </div>
    </div>
  );
}

function Connector({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 56 40"
      aria-hidden="true"
      className="shrink-0"
      style={{ width: "clamp(28px,6vw,56px)", height: 40, overflow: "visible" }}
    >
      <path
        d={back ? "M 4 14 Q 28 38 52 14" : "M 4 26 Q 28 2 52 26"}
        fill="none"
        stroke="var(--mk-border)"
        strokeWidth={2}
        strokeDasharray="4 5"
        strokeLinecap="round"
      />
      <path
        d={back ? "M 49 18 L 52 14 L 56 17" : "M 49 23 L 52 26 L 56 22"}
        fill="none"
        stroke="var(--mk-violet-400)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CustodySpotlight() {
  return (
    <Section tint>
      <Container>
        <div className="grid items-center gap-[clamp(32px,4vw,64px)] grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] max-[860px]:grid-cols-1">
          <Reveal>
            <div className="max-w-[520px]">
              <Eyebrow>Peace of mind</Eyebrow>
              <h2 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(26px,3.6vw,38px)] leading-[1.1] mt-3.5">
                Always know who has your box.
              </h2>
              <p className="mt-4 text-[clamp(15px,1.3vw,17px)] leading-relaxed text-mk-text-muted text-pretty">
                Lending something you love shouldn&apos;t feel risky. Every box
                you send out stays on your shelf as &ldquo;lent&rdquo; — so you
                always see who has it, and when it&apos;s due back.
              </p>
              <p className="mt-5 inline-flex items-center gap-2 text-[15px] font-semibold text-mk-text-strong">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: "var(--mk-green-500)" }}
                  aria-hidden="true"
                />
                Lend freely. Nothing gets lost.
              </p>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="rounded-[var(--v-radius-card)] bg-mk-card border border-mk-border shadow-mk-sm p-[clamp(24px,4vw,40px)]">
              <CustodyDiagram />
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
