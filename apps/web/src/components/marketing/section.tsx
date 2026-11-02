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
