import * as React from "react";

// Entrance on scroll, once. Base state is VISIBLE: the server and a page without JavaScript paint full
// content, and nothing is hidden until the visitor first scrolls, so nothing can get stuck hidden. At
// that first scroll, whatever started well below the fold is put in its starting state; it enters when
// it reaches the viewport, which is at once if the scroll jumped straight to it. Reduced motion keeps
// the fade and drops the rise.
export function Reveal({
  delay = 0,
  rise = 24,
  className,
  style,
  children,
}: {
  delay?: number;
  rise?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<"rest" | "waiting" | "entering">(
    "rest",
  );
  const [lift, setLift] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let io: IntersectionObserver | undefined;
    const startedBelowFold =
      el.getBoundingClientRect().top + window.scrollY >=
      window.innerHeight + 80;
    const arm = () => {
      if (!startedBelowFold) return;
      setLift(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : rise,
      );
      setState("waiting");
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setState("entering");
            io?.disconnect();
          }
        },
        { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
      );
      io.observe(el);
    };
    window.addEventListener("scroll", arm, { once: true, passive: true });
    return () => {
      window.removeEventListener("scroll", arm);
      io?.disconnect();
    };
  }, [rise]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...(state === "waiting" && {
          opacity: 0,
          transform: lift ? `translateY(${lift}px)` : undefined,
        }),
        ...(state === "entering" && {
          transition: `opacity .56s var(--ease-mk-out) ${delay}ms, transform .56s var(--ease-mk-out) ${delay}ms`,
        }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
