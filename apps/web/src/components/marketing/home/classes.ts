// Class strings the marketing chrome and home sections share.

// Press feedback for anything pressable.
export const PRESS =
  "transition-transform duration-[160ms] ease-mk-out motion-safe:active:scale-[0.97]";

// A focus ring in the ink of whatever field the control stands on.
export const FOCUS =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-current";

// The home page's measure: full width with the hero's 40px margins, 16px on a phone.
export const EDGE = "w-full px-4 min-[760px]:px-10";

// One entrance for text in the first viewport, played when it first paints. Plain CSS, so it runs without
// JavaScript and leaves the content visible if it does not run at all.
export const ENTER =
  "motion-safe:transition-[opacity,translate] motion-safe:duration-500 motion-safe:ease-mk-out motion-safe:starting:opacity-0 motion-safe:starting:translate-y-5";

// A plain underlined text link.
export const TEXT_LINK = `underline decoration-2 underline-offset-4 ${PRESS} ${FOCUS}`;
