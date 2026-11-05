import { Image } from "@/compat/image";
// 96px covers the 26px mark at 3x (assets/icon.png is the 256px source).
import logoMark from "@/components/marketing/assets/icon-96.webp";
import { cn } from "@/lib/utils";

// The logo: the violet puzzle-piece mark and the live wordmark. Its colours are the logo's own and
// do not follow the theme's primary.
// Above the fold in the desktop top bar, so the mark loads eagerly and first.
export function HeaderLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {/* max-w-none: a percentage max-width lets a grid track size past the mark. */}
      <Image
        src={logoMark}
        alt=""
        width={26}
        height={26}
        priority
        className="block max-w-none"
      />
      <span className="font-logo text-[21px] leading-none font-bold">
        <span className="text-logo-jig">Jig</span>
        <span className="text-logo-swap">Swap</span>
      </span>
    </span>
  );
}
