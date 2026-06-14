import * as React from "react";

// next/image compat: approximates next/image props with a styled <img>. No
// optimization pipeline — `fill` maps to absolute-cover, `priority` to eager
// loading. Ported `next/image` files just swap the import.
type ImgProps = Omit<
  React.ComponentPropsWithoutRef<"img">,
  "src" | "width" | "height"
>;

export interface ImageProps extends ImgProps {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  // Accepted for source-compatibility, then ignored.
  quality?: number;
  sizes?: string;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
  loader?: unknown;
}

export function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  sizes,
  style,
  className,
  // Accepted from the next/image API surface but not forwarded to the DOM.
  quality,
  placeholder,
  blurDataURL,
  unoptimized,
  loader,
  ...rest
}: ImageProps) {
  void quality;
  void placeholder;
  void blurDataURL;
  void unoptimized;
  void loader;

  // A `fill` image is absolutely positioned to cover its (positioned) parent. The object-fit is
  // applied inline so it deterministically wins, but it HONORS an explicit `object-*` utility in
  // `className` (e.g. `object-contain`) — defaulting to `cover` when none is given. (Previously this
  // hardcoded `cover`, silently overriding any `object-contain` class.)
  const objectFit: React.CSSProperties["objectFit"] = className?.includes(
    "object-contain",
  )
    ? "contain"
    : className?.includes("object-scale-down")
      ? "scale-down"
      : className?.includes("object-fill")
        ? "fill"
        : className?.includes("object-none")
          ? "none"
          : "cover";

  const fillStyle: React.CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit,
      }
    : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}

export default Image;
