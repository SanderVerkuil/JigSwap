import { StreetSkyline } from "@/components/common/street-skyline";
import { Wordmark } from "@/components/marketing/wordmark";
import { cn } from "@/lib/utils";
import * as React from "react";

// Clerk's card in the street's own materials: flat, small radius, our faces, a marigold primary.
// ClerkProvider already maps the colour tokens to the app theme; this narrows it for the auth pages.
// The `!` overrides are needed because Clerk's own emotion rules otherwise win on specificity.
export const authAppearance = {
  variables: {
    colorPrimary: "var(--mk-gold)",
    colorTextOnPrimaryBackground: "var(--mk-on-gold)",
    colorPrimaryForeground: "var(--mk-on-gold)",
    colorBackground: "var(--mk-card)",
    colorText: "var(--mk-text-strong)",
    colorTextSecondary: "var(--mk-text-muted)",
    colorInputBackground: "var(--mk-card)",
    colorInputText: "var(--mk-text-strong)",
    fontFamily: "var(--font-mk-sans)",
    fontFamilyButtons: "var(--font-mk-sans)",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "mx-auto",
    cardBox: "shadow-none! border-0! rounded-md!",
    card: "shadow-none! border-0! rounded-md!",
    headerTitle:
      "font-mk-heading! text-mk-text-strong! text-[26px]! font-normal!",
    socialButtonsIconButton:
      "shadow-none! border! border-solid! border-mk-input-border!",
    formButtonPrimary:
      "shadow-none! border-0! bg-none! bg-mk-gold! text-mk-on-gold! hover:bg-mk-gold-press! after:hidden! before:hidden! transition-[background-color,transform] duration-150 ease-mk-out motion-safe:active:scale-[0.97]",
    formFieldInput:
      "shadow-none! border! border-solid! border-mk-input-border! bg-mk-card! text-mk-text-strong!",
    footer: "bg-none! bg-mk-sky-soft!",
    footerActionLink: "text-mk-text-strong! underline! underline-offset-3!",
    formFieldAction: "text-mk-text-strong! underline!",
    identityPreviewEditButton: "text-mk-text-strong!",
  },
} as const;

// The field behind sign-in and sign-up: the flat sky, the logo home, and the row of gables at the foot.
export function AuthField({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-mk-sky font-mk-sans relative flex min-h-svh flex-col items-center gap-6 overflow-hidden px-4 pt-7 pb-[136px]">
      <a href="/" aria-label="JigSwap" className="relative z-10">
        <Wordmark />
      </a>
      <div className="relative z-10 my-auto w-full max-w-md">{children}</div>
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 flex justify-center"
      >
        {[0, 1, 2, 3].map((i) => (
          <StreetSkyline
            key={i}
            className={cn(
              "text-mk-canal h-[120px] w-[480px] shrink-0 dark:[--skyline-window:var(--mk-gold)]",
              i % 2 === 1 && "-scale-x-100",
            )}
          />
        ))}
      </div>
    </div>
  );
}
