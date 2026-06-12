import { cn } from "@/lib/utils";
import * as React from "react";

// Marketing layout shell: 1200px max width, 24px gutters (design --container-max).
// `narrow` is the 760px reading column used by legal docs and step lists.
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
        "w-full mx-auto px-6",
        narrow ? "max-w-[760px]" : "max-w-[1200px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
