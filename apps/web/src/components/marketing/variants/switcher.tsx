import { Check, Moon, Palette, Sun, X } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { VARIANTS, type VariantId } from "./registry";

// Floating "tweaks" panel for reviewing landing-page variants.
//
// Sits fixed in the bottom-right so it never pushes page layout around. Lets a
// reviewer flip between the four redesigns + the original baseline and toggle
// dark mode, all without leaving the page. This is a review-only control — it
// is not part of any shipped variant and would be removed once a winner is
// picked.

export function VariantSwitcher({
  current,
  onChange,
}: {
  current: VariantId;
  onChange: (id: VariantId) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <div className="fixed bottom-4 right-4 z-[9999] font-mk-sans print:hidden">
      {open ? (
        <div
          role="dialog"
          aria-label="Landing variant switcher"
          className="w-[280px] rounded-2xl border border-black/10 bg-white/85 p-3 text-[#1f1b2e] shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1b1d24]/90 dark:text-[#f6f2ed]"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-70">
              <Palette size={14} />
              Variant
            </div>
            <button
              type="button"
              aria-label="Close switcher"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <X size={16} />
            </button>
          </div>

          <ul className="flex flex-col gap-1">
            {VARIANTS.map((v) => {
              const active = v.id === current;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(v.id)}
                    className={[
                      "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                      active
                        ? "bg-[#6048e8]/12 ring-1 ring-[#6048e8]/40"
                        : "hover:bg-black/5 dark:hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span className="mt-0.5 w-4 shrink-0">
                      {active ? (
                        <Check size={16} className="text-[#6048e8]" />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {v.label}
                      </span>
                      <span className="block text-[11px] leading-snug opacity-60">
                        {v.tagline}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center justify-between border-t border-black/10 px-1 pt-2 dark:border-white/10">
            <span className="text-xs opacity-70">Appearance</span>
            <button
              type="button"
              aria-label={
                isDark ? "Switch to light mode" : "Switch to dark mode"
              }
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/5"
            >
              {isDark ? <Moon size={14} /> : <Sun size={14} />}
              {isDark ? "Dark" : "Light"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          aria-label="Open landing variant switcher"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-black/10 bg-white/85 px-4 py-2.5 text-sm font-semibold text-[#1f1b2e] shadow-xl backdrop-blur-xl transition-transform hover:scale-[1.03] dark:border-white/10 dark:bg-[#1b1d24]/90 dark:text-[#f6f2ed]"
        >
          <Palette size={16} className="text-[#6048e8]" />
          {VARIANTS.find((v) => v.id === current)?.label ?? "Variant"}
        </button>
      )}
    </div>
  );
}
