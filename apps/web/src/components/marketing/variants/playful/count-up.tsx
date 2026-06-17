import * as React from "react";

// Animated number that tweens 0 → value when `active` flips true. Honors
// reduced-motion (renders the final value instantly) and renders the final
// value statically on the server / before activation so no-JS users see a real
// number, never 0. Uses tabular-nums so the width stays stable while counting.
export function CountUp({
  value,
  active,
  duration = 900,
  format,
  className,
}: {
  value: number;
  active: boolean;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(value);
  const startedRef = React.useRef(false);
  const fmt = format ?? ((n: number) => String(n));

  React.useEffect(() => {
    if (!active || startedRef.current) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      startedRef.current = true;
      return;
    }
    startedRef.current = true;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setDisplay(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value, duration]);

  // Keep in sync if the live value resolves after activation.
  React.useEffect(() => {
    if (startedRef.current) setDisplay(value);
  }, [value]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {fmt(display)}
    </span>
  );
}
