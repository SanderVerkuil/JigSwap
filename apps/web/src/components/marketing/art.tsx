import { cn } from "@/lib/utils";

// One cut of the owner's village art. Always carries its real size so the page does not jump; callers
// crop further with object-fit classes. It loads lazily unless it is `priority`, the art on the first
// screen, which loads at once and ahead of the rest. `srcSet` and `sizes` offer its smaller renditions.
export function Art({
  src,
  srcSet,
  sizes,
  width,
  height,
  alt,
  priority = false,
  className,
}: {
  src: string;
  srcSet?: string;
  sizes?: string;
  width: number;
  height: number;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn("block h-auto w-full", className)}
    />
  );
}
