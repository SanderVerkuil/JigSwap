// Early connections to the third-party origins every page needs before it is usable: Clerk's
// Frontend API (clerk-js, @clerk/ui and the session calls) and the Convex deployment (the sync
// socket's DNS, and storage images). Pure, so it unit-tests in node.

const PUBLISHABLE_KEY = /^pk_(?:test|live)_(.+)$/;
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/**
 * The Clerk Frontend API origin encoded in a publishable key (`pk_test_` / `pk_live_` +
 * base64("<host>$")), or null when the key is missing or malformed.
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined,
): string | null {
  const encoded = publishableKey?.match(PUBLISHABLE_KEY)?.[1];
  if (!encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1);
  return HOST.test(host) ? `https://${host}` : null;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type PreconnectLink = {
  rel: "preconnect";
  href: string;
  crossOrigin?: "anonymous";
};

/** Root `<head>` preconnect links for the configured Clerk and Convex origins. */
export function preconnectLinks(env: {
  clerkPublishableKey?: string;
  convexUrl?: string;
}): PreconnectLink[] {
  const links: PreconnectLink[] = [];
  const clerk = clerkFrontendApiOrigin(env.clerkPublishableKey);
  if (clerk) {
    // clerk-js and @clerk/ui load as crossorigin="anonymous" scripts, while the Frontend API
    // calls carry credentials: browsers keep those in separate connection pools, so warm both.
    links.push(
      { rel: "preconnect", href: clerk, crossOrigin: "anonymous" },
      { rel: "preconnect", href: clerk },
    );
  }
  const convex = originOf(env.convexUrl);
  if (convex) links.push({ rel: "preconnect", href: convex });
  return links;
}
