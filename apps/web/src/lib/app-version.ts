// Decides when to tell a member that a newer build of JigSwap is deployed. The build id baked
// into the bundle (see vite-plugin-app-version.ts) is compared with the one served at
// /version.json; a failed chunk load (stale chunks after a deploy) is a signal too, without
// knowing the new id. Each version prompts once per page load, so a dismissed prompt stays
// dismissed until yet another deploy lands.

/** Stands in for "some newer build" when a chunk failed to load and the new id is unknown. */
export const STALE_BUILD = "stale";

/** Where the deployed build id is published; served uncached. */
export const VERSION_URL = "/version.json";

/** How often to check while the tab is visible. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Returns the version to prompt for, or null to stay quiet.
 * @param current the build id this page was loaded with
 * @param prompted the version last prompted for on this page, if any
 * @param latest the deployed build id, or STALE_BUILD after a chunk-load failure
 */
export function versionToPrompt(
  current: string,
  prompted: string | null,
  latest: string | null,
): string | null {
  if (!latest || latest === current || latest === prompted) return null;
  // A chunk-load failure already prompted for "whatever is newer"; the version it found is
  // almost certainly that same deploy, so don't prompt twice for it. And a chunk failure after
  // any prompt adds nothing new.
  if (prompted === STALE_BUILD || (latest === STALE_BUILD && prompted)) {
    return null;
  }
  return latest;
}

/** Reads the build id out of a /version.json body; null when it isn't one. */
export function parseVersion(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { version } = body as { version?: unknown };
  return typeof version === "string" && version.length > 0 ? version : null;
}
