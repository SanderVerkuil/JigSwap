// Clerk's card in the street's own materials: flat, small radius, our faces, a marigold primary.
// ClerkProvider already maps the colour tokens to the app theme; this narrows it for the auth pages.
// The `!` overrides are needed because Clerk's own emotion rules otherwise win on specificity.
// Clerk draws its focus ring as a box-shadow, which shadow-none! removes, so the buttons get the
// street's 3px ink outline and the fields the ring-coloured border and 3px ring instead.
const BUTTON_FOCUS =
  "focus-visible:outline-solid! focus-visible:outline-3! focus-visible:outline-offset-2! focus-visible:outline-mk-ring!";

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
    socialButtonsIconButton: `shadow-none! border! border-solid! border-mk-input-border! ${BUTTON_FOCUS}`,
    formButtonPrimary: `shadow-none! border-0! bg-none! bg-mk-gold! text-mk-on-gold! hover:bg-mk-gold-press! after:hidden! before:hidden! transition-[background-color,transform] duration-150 ease-mk-out motion-safe:active:scale-[0.97] ${BUTTON_FOCUS}`,
    formFieldInput:
      "shadow-none! border! border-solid! border-mk-input-border! bg-mk-card! text-mk-text-strong! focus:border-mk-ring! focus:ring-3! focus:ring-mk-ring/50!",
    footer: "bg-none! bg-mk-sky-soft!",
    footerActionLink: "text-mk-text-strong! underline! underline-offset-3!",
    formFieldAction: "text-mk-text-strong! underline!",
    identityPreviewEditButton: "text-mk-text-strong!",
  },
} as const;
