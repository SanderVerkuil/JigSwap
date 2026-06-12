import { cn } from "@/lib/utils";
import * as React from "react";

// Marketing section rhythm: clamp(56px, 8vw, 104px) vertical padding;
// `tint` alternates onto the muted surface for banded layouts.
export function Section({
  tint = false,
  id,
  className,
  children,
}: {
  tint?: boolean;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-[clamp(56px,8vw,104px)]",
        tint && "bg-mk-muted",
        className,
      )}
    >
      {children}
    </section>
  );
}

// Mono uppercase kicker with the short brand dash.
export function Eyebrow({
  center = false,
  className,
  children,
}: {
  center?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 font-mono text-xs font-semibold tracking-[.12em] uppercase text-mk-violet-600",
        center && "justify-center",
        className,
      )}
    >
      <span className="w-[18px] h-0.5 rounded-xs bg-mk-violet-400" />
      {children}
    </div>
  );
}

// Section opener: eyebrow + display title + optional lead paragraph.
export function SectionHead({
  eyebrow,
  title,
  lead,
  align = "left",
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
}) {
  const center = align === "center";
  return (
    <div className={cn(center && "text-center max-w-[760px] mx-auto")}>
      {eyebrow && <Eyebrow center={center}>{eyebrow}</Eyebrow>}
      <h2 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(28px,4vw,40px)] leading-[1.1] mt-3.5">
        {title}
      </h2>
      {lead && (
        <p
          className={cn(
            "mt-4 text-lg leading-relaxed text-mk-text-muted max-w-[620px] text-pretty",
            center && "mx-auto",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
