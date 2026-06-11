import * as React from "react";

// SSR-safe layout effect: layout on the client, plain effect during SSR render.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

// Reveal-on-scroll. Base state is VISIBLE — nothing can ever get stuck hidden
// (and SSR paints full content). Only elements that start below the fold are
// hidden and animated in on intersection; reduced-motion users get no animation.
export function Reveal({
  delay = 0,
  className,
  style,
  children,
}: {
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(true);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < (window.innerHeight || 800) - 60) return; // above/at fold → stay visible
    setShown(false);
    let done = false;
    const reveal = () => {
      if (!done) {
        done = true;
        setShown(true);
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            reveal();
            io.disconnect();
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    const fallback = setTimeout(reveal, 1400);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(18px)",
        transition: `opacity .6s var(--ease-mk-out) ${delay}ms, transform .6s var(--ease-mk-out) ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
