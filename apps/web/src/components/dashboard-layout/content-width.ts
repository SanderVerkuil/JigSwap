// The centered page column used when the "full width" shell preference is off.
// Shared by the dashboard shell's content area and pages rendered outside the
// shell (the logged-out member profile) so the 1180px number lives in one place.
export function contentWidthClass(fullWidth: boolean): string | undefined {
  return fullWidth ? undefined : "mx-auto max-w-[1180px]";
}
