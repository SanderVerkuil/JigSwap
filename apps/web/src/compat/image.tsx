import * as React from "react";

// next/image compat: approximates next/image props with a styled <img>. No
// optimization pipeline — `fill` absolutely positions the image to fill its
// (positioned) parent, `priority` maps to eager loading. Like real next/image,
// object-fit is the caller's job: pass `className="object-cover"` /
// `object-contain`. Ported `next/image` files just swap the import.
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

  // A `fill` image is absolutely positioned to fill its (positioned) parent. Object-fit is left to
  // the caller's `className` (`object-cover` / `object-contain`) — no inline override, matching
  // next/image (which has no objectFit prop and forces no default fit).
  const fillStyle: React.CSSProperties | undefined = fill
    ? {
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
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
