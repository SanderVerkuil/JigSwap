// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  isClerkDefaultAvatar,
} from "./avatar";

// A member without a photo looks the same everywhere: Clerk's generated default picture (a violet
// gradient, which the backend stores as the avatar) is never drawn, and the fallback is the shell's
// initial, white on Canal Primary.

// Clerk image URLs carry base64 JSON in the path: "default" for the generated picture, "proxy" for a
// photo. Unpadded url-safe base64 ("-" and "_") is accepted as well.
const CLERK_DEFAULT =
  "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCIsImlpZCI6Imluc18yWGsxIiwicmlkIjoidXNlcl8yWXE5IiwiaW5pdGlhbHMiOiJISiJ9";
const CLERK_DEFAULT_URLSAFE =
  "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCIsImluaXRpYWxzIjoifj8-In0?width=80";
const CLERK_PHOTO =
  "https://img.clerk.com/eyJ0eXBlIjoicHJveHkiLCJzcmMiOiJodHRwczovL2ltYWdlcy5jbGVyay5kZXYvdXBsb2FkZWQvaW1nXzJacjQuanBlZyJ9";

describe("isClerkDefaultAvatar", () => {
  it("recognises Clerk's generated default picture", () => {
    expect(isClerkDefaultAvatar(CLERK_DEFAULT)).toBe(true);
    expect(isClerkDefaultAvatar(CLERK_DEFAULT_URLSAFE)).toBe(true);
  });

  it("leaves photos, other hosts and anything unreadable alone", () => {
    expect(isClerkDefaultAvatar(CLERK_PHOTO)).toBe(false);
    expect(
      isClerkDefaultAvatar(CLERK_DEFAULT.replace("img.clerk.com", "cdn.test")),
    ).toBe(false);
    expect(isClerkDefaultAvatar("https://img.clerk.com/anon.png")).toBe(false);
    expect(isClerkDefaultAvatar("not a url")).toBe(false);
    expect(isClerkDefaultAvatar(undefined)).toBe(false);
  });
});

describe("Avatar", () => {
  // Every image "loads" at once, so Radix draws the <img> whenever AvatarImage asks for one.
  beforeEach(() => {
    vi.stubGlobal(
      "Image",
      class {
        complete = true;
        naturalWidth = 1;
        src = "";
        addEventListener() {}
        removeEventListener() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderAvatar = (src: string) =>
    render(
      <Avatar>
        <AvatarImage src={src} alt="Henk" />
        <AvatarFallback>H</AvatarFallback>
      </Avatar>,
    ).container;

  it("shows the initial instead of Clerk's default picture", () => {
    const container = renderAvatar(CLERK_DEFAULT);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-slot="avatar-fallback"]')?.textContent,
    ).toBe("H");
  });

  it("still shows a real photo", () => {
    const container = renderAvatar(CLERK_PHOTO);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      CLERK_PHOTO,
    );
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toBeNull();
  });

  it("draws the fallback initial white on Canal Primary", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>H</AvatarFallback>
      </Avatar>,
    );
    const fallback = container.querySelector('[data-slot="avatar-fallback"]');
    expect(fallback?.classList).toContain("bg-primary");
    expect(fallback?.classList).toContain("text-primary-foreground");
    expect(fallback?.classList).not.toContain("bg-muted");
  });
});
