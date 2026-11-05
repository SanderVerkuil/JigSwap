import { cn } from "@/lib/utils";
import * as React from "react";

// Marketing layout shell: the home page's measure, full width with 40px margins and 16px on a phone, so
// the header's logo and a page's text share one edge. `narrow` is a 760px reading column on that edge.
export function Container({
  narrow = false,
  className,
  children,
}: {
  narrow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full px-4 min-[760px]:px-10",
        narrow && "max-w-[840px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
