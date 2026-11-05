// Initials-avatar fills used on the marketing pages (hero trust row, the
// "my puzzles" feature visual), each paired with the initials colour that
// keeps them at WCAG AA (4.5:1) in light AND dark mode. The green step gets
// lighter in dark mode and the pink seed is mid-tone, so both take dark
// initials; white is only safe on the violet seed. Guarded by
// styles/marketing-contrast.test.tsx.
export const MK_AVATAR_TONES = {
  violet: { bg: "var(--mk-violet-400)", fg: "#ffffff" },
  green: { bg: "var(--mk-green-500)", fg: "#1f1b2e" },
  pink: { bg: "var(--mk-pink-400)", fg: "#1f1b2e" },
} as const;

export type MkAvatarTone =
  (typeof MK_AVATAR_TONES)[keyof typeof MK_AVATAR_TONES];
