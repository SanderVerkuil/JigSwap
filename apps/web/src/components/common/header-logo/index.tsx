import { Image } from "@/compat/image";
import { cn } from "@/lib/utils";
// 3x the top bar's 28px logo height (logo-horizontal.png is the full-size source).
import headerLogo from "./logo-horizontal-84h.webp";

// Above the fold in the desktop top bar, so it loads eagerly and first.
export function HeaderLogo({ className }: { className?: string }) {
  return (
    <Image
      src={headerLogo}
      alt="JigSwap Logo"
      width={108}
      height={28}
      priority
      className={cn("pl-4 h-8 w-auto object-contain", className)}
    />
  );
}
