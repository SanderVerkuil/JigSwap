import { cn } from "@/lib/utils";

// One cut of the owner's village art. Always carries its real size so the page does not jump, and
// loads lazily; callers crop further with object-fit classes.
export function Art({
  src,
  width,
  height,
  alt,
  className,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn("block h-auto w-full", className)}
    />
  );
}
