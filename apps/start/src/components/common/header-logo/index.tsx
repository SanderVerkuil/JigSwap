import { Image } from "@/compat/image";
import { cn } from "@/lib/utils";
import HeaderIcon from "./logo-horizontal.png";

export function HeaderLogo({ className }: { className?: string }) {
  return (
    <Image
      src={HeaderIcon}
      alt="JigSwap Logo"
      className={cn("pl-4 h-8 w-auto object-contain", className)}
    />
  );
}
