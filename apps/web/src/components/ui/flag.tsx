// Hand-inlined flag SVGs: emoji flags render as letter pairs on Windows and
// Linux Chrome, and the flag-icons package weighs ~500KB for the two locales
// we support. Sized via className (defaults to the 16x12 form-control size).

import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

type FlagProps = ComponentProps<"svg">;

// overflow-hidden makes the rounding actually clip the painted rects.
const flagClass = (className?: string) =>
  cn(
    "h-3 w-4 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-border",
    className,
  );

// Simplified Union Jack: diagonals are centered instead of counterchanged.
export function FlagEn({ className, ...props }: FlagProps) {
  return (
    <svg
      viewBox="0 0 60 45"
      aria-hidden="true"
      className={flagClass(className)}
      {...props}
    >
      <rect width="60" height="45" fill="#012169" />
      <path d="M0 0 60 45M60 0 0 45" stroke="#FFFFFF" strokeWidth="9" />
      <path d="M0 0 60 45M60 0 0 45" stroke="#C8102E" strokeWidth="5" />
      <path d="M30 0v45M0 22.5h60" stroke="#FFFFFF" strokeWidth="15" />
      <path d="M30 0v45M0 22.5h60" stroke="#C8102E" strokeWidth="9" />
    </svg>
  );
}

export function FlagNl({ className, ...props }: FlagProps) {
  return (
    <svg
      viewBox="0 0 60 45"
      aria-hidden="true"
      className={flagClass(className)}
      {...props}
    >
      <rect width="60" height="15" fill="#AE1C28" />
      <rect y="15" width="60" height="15" fill="#FFFFFF" />
      <rect y="30" width="60" height="15" fill="#21468B" />
    </svg>
  );
}

const FLAGS: Record<Locale, (props: FlagProps) => React.JSX.Element> = {
  en: FlagEn,
  nl: FlagNl,
};

export function Flag({ locale, ...props }: FlagProps & { locale: Locale }) {
  const Component = FLAGS[locale];
  return <Component {...props} />;
}
