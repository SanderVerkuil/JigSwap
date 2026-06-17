import { cn } from "@/lib/utils";

// CSS barcode (repeating-linear-gradient bars) — decorative colophon mark.
export function Barcode({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "v-barcode h-12 w-full max-w-[220px] rounded-[2px]",
        className,
      )}
    />
  );
}
