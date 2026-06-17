import { Container } from "@/components/marketing/container";
import { cn } from "@/lib/utils";

// The editorial signature: a hairline horizontal rule with a centered mono
// label (e.g. "No. 02 — Manifesto"). Used as a divider between major sections.
// Purely presentational; the label is short context, not a heading.
export function RuleLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <Container className={cn("py-[clamp(28px,5vw,56px)]", className)}>
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-mk-border" />
        <span className="ed-mono text-[11px] font-semibold tracking-[0.22em] uppercase text-mk-text-muted whitespace-nowrap">
          {label}
        </span>
        <span className="h-px flex-1 bg-mk-border" />
      </div>
    </Container>
  );
}
