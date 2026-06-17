import { cn } from "@/lib/utils";
import * as React from "react";

// Single source for every photographic slot in the Cozy variant. No real
// lifestyle photos exist, so each slot ships as a warm CSS gradient + SVG
// grain fallback that reads as deliberate art, not a missing image. When a
// real photo lands later it drops in over this same box as `background-image`
// (progressive enhancement); the gradient stays as the SSR/no-image baseline.
//
// The `label` is the designer's [PHOTO PLACEHOLDER: …] note — surfaced only to
// devs via a `data-photo` attribute and an HTML comment, never visible/announced.
// The whole box is decorative: callers keep it `aria-hidden` and carry meaning
// in text. Optional `src` is reserved for the future real photo.
export function PhotoFallback({
  label,
  src,
  className,
  style,
  children,
}: {
  label: string;
  src?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const bgStyle: React.CSSProperties = src
    ? {
        backgroundImage: `image-set(url("${src}") 1x), var(--cozy-fallback-bg, none)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...style,
      }
    : (style ?? {});

  return (
    <div
      aria-hidden="true"
      data-photo={label}
      className={cn(
        "cozy-photo-fallback cozy-grain relative overflow-hidden",
        className,
      )}
      style={bgStyle}
    >
      {/* [PHOTO PLACEHOLDER] — see data-photo attr for the intended shot. */}
      {children}
    </div>
  );
}
