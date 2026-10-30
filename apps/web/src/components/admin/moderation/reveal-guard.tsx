"use client";

// Blur-until-reveal guard for photos an admin reviews (flagged, unchecked, reported, appealed).
// The photo always starts behind a blurred overlay that is one big button: only a click, a tap, or
// Enter/Space on it reveals the photo. Nothing reacts to a pointer passing over it. Once revealed,
// a "Hide again" button blurs it again. Focus follows the toggle (overlay -> Hide again -> overlay)
// so a keyboard user never lands on <body>. Render it inside a positioned, sized frame; siblings
// placed after it (a severity badge) stay on top of the overlay. Callers key it per photo so a new
// photo never inherits a reveal.
import { Button } from "@/components/ui/button";
import { EyeOff } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "use-intl";

export function RevealGuard({ children }: { children: ReactNode }) {
  const t = useTranslations("admin.moderation.revealGuard");
  const [revealed, setRevealed] = useState(false);
  const revealRef = useRef<HTMLButtonElement>(null);
  const hideRef = useRef<HTMLButtonElement>(null);

  const toggle = (next: boolean) => {
    // Commit first so the button that takes focus exists.
    flushSync(() => setRevealed(next));
    (next ? hideRef : revealRef).current?.focus();
  };

  return (
    <div className="relative size-full">
      {children}
      {revealed ? (
        <Button
          ref={hideRef}
          type="button"
          size="sm"
          variant="secondary"
          className="absolute right-3 bottom-3 h-11 shadow-md md:h-8"
          onClick={() => toggle(false)}
        >
          <EyeOff aria-hidden />
          {t("hide")}
        </Button>
      ) : (
        <button
          ref={revealRef}
          type="button"
          onClick={() => toggle(true)}
          className="absolute inset-0 flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1.5 bg-black/30 px-4 text-center text-white backdrop-blur-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset"
        >
          <EyeOff className="size-5" aria-hidden />
          <span className="text-xs font-semibold">{t("reveal")}</span>
        </button>
      )}
    </div>
  );
}
