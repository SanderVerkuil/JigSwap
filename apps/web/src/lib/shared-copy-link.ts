// The link a member sends to one puzzle they offer (/copies/<id>?shared=1). The flag tells its
// signed-out visitor, who most likely has no account yet, from a member whose session lapsed: the
// first lands on sign-up, the second on sign-in, both returning to the copy afterwards.
const COPY_PATH = /^\/copies\/[^/]+\/?$/;

export const sharedCopyUrl = (origin: string, copyId: string): string =>
  `${origin}/copies/${encodeURIComponent(copyId)}?shared=1`;

// Takes an href or a full URL: Clerk may hand redirect_url back absolute.
export const isSharedCopyHref = (href: unknown): boolean => {
  if (typeof href !== "string") return false;
  try {
    const url = new URL(href, "https://jigswap.site");
    return (
      COPY_PATH.test(url.pathname) && url.searchParams.get("shared") === "1"
    );
  } catch {
    return false;
  }
};
