"use client";

import { cn } from "@/lib/utils";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
  );
}

// Clerk gives every account an image URL. Without an uploaded photo it is a generated default, a
// violet gradient, and that URL is what a member's stored avatar holds. Its path is base64 JSON
// whose type is "default" (a photo is "proxy"), so it is recognised here and never drawn.
export function isClerkDefaultAvatar(src: string | undefined): boolean {
  if (!src) return false;
  try {
    const url = new URL(src);
    if (url.hostname !== "img.clerk.com") return false;
    const payload = url.pathname.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload))?.type === "default";
  } catch {
    return false;
  }
}

// Clerk's default picture is skipped, so a member without a photo shows the fallback's initial on
// every surface, as the shell's account button does.
function AvatarImage({
  className,
  src,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  if (isClerkDefaultAvatar(src)) return null;
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      src={src}
      {...props}
    />
  );
}

// One fallback for every member: the initial in white on Canal Primary, the shell's account button.
function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-primary text-primary-foreground flex size-full items-center justify-center rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
