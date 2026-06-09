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

  const fillStyle: React.CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }
    : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
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
