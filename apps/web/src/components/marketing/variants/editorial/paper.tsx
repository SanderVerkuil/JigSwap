import { cn } from "@/lib/utils";
import * as React from "react";

// Wraps a region with the paper-grain overlay (defined in editorial.css as
// `.grain`). The grain is an absolutely-positioned, aria-hidden ::after at
// `--v-grain-opacity`; children are lifted above it. Use sparingly on large
// paper grounds so the page reads like newsprint, never flat-digital.
export function Paper({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "section";
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("grain", className)} {...rest}>
      {children}
    </Tag>
  );
}
