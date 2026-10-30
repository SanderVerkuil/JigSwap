import { Image } from "@/compat/image";
// Icon-only mark (hands-in-puzzle-piece) — the header-icon asset is the
// stacked lockup with the wordmark text baked in underneath. 96px covers the
// default 30px mark at 3x (assets/icon.png is the 256px source).
import logoIcon from "@/components/marketing/assets/icon-96.webp";
import { cn } from "@/lib/utils";

// Logo mark + two-tone wordmark: violet "Jig", green "Swap" (Fraunces 700).
// `textClassName` lets a tight layout hide the name and keep the mark.
// `priority` for the header copy, which is above the fold.
export function Wordmark({
  size = 22,
  textClassName,
  priority = false,
}: {
  size?: number;
  textClassName?: string;
  priority?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-[9px]">
      <Image
        src={logoIcon}
        alt=""
        width={size + 8}
        height={size + 8}
        priority={priority}
        className="block rounded-[7px]"
      />
      <span
        className={cn(
          "font-mk-heading font-bold leading-none tracking-[-0.01em]",
          textClassName,
        )}
        style={{ fontSize: size }}
      >
        <span className="text-mk-violet-600">Jig</span>
        <span className="text-mk-green-600">Swap</span>
      </span>
    </span>
  );
}
