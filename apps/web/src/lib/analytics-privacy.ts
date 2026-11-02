import type { CaptureResult } from "posthog-js";

// PostHog's before_send filter (wired in ./analytics-client). It runs in the
// browser on every event, whichever PostHog feature produced it (pageviews,
// autocapture, web vitals, heatmaps, session-replay markers), so these rules
// hold before anything leaves the device:
//  - URLs lose their query string and fragment. Invite links carry their
//    token in `?invite=`, and analytics never needs what follows the path.
//  - Clicks, rage clicks, dead clicks and copies on the messaging screens are
//    dropped, so private-message text and link targets never reach PostHog,
//    even if a component loses its `ph-no-capture` class.
//  - The page title is dropped from every event. PostHog copies document.title
//    into each $pageview, and the tab names the page after what it shows
//    (ShellDocumentTitle): a circle, a household, another member. $pathname
//    already says which page it was.

type Properties = CaptureResult["properties"];

// Property names whose string values are URLs: $current_url, $referrer,
// $initial_*/$session_entry_* copies of both, $external_click_url, and
// href/attr__href on autocaptured elements.
const URL_KEY = /(?:url|referrer|href)$/i;
// Deep enough for web-vitals metrics and $elements; bounds odd payloads.
const MAX_DEPTH = 6;

// Interaction events that can carry clicked text, link targets or copied text.
const DROPPED_ON_MESSAGES = new Set([
  "$autocapture",
  "$rageclick",
  "$dead_click",
  "$copy_autocapture",
]);
const MESSAGES_PATH = /^\/messages(?:\/|$)/;

// rrweb event types that carry the page URL in session replay.
const REPLAY_META = 4;
const REPLAY_CUSTOM = 5;
const REPLAY_PLUGIN = 6;

export function stripUrlQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

export function sanitizeAnalyticsEvent(
  event: CaptureResult,
): CaptureResult | null {
  const properties = event.properties ?? {};
  if (
    DROPPED_ON_MESSAGES.has(event.event) &&
    MESSAGES_PATH.test(String(properties.$pathname ?? ""))
  ) {
    return null;
  }
  return {
    ...event,
    properties: sanitizeProperties(properties),
    ...(event.$set && { $set: scrubRecord(event.$set) }),
    ...(event.$set_once && { $set_once: scrubRecord(event.$set_once) }),
  };
}

function sanitizeProperties(properties: Properties): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "title") continue;
    if (key === "$elements_chain" && typeof value === "string") {
      out[key] = stripChainHrefs(value);
    } else if (key === "$heatmap_data" && isRecord(value)) {
      out[key] = foldHeatmapUrls(value);
    } else if (key === "$snapshot_data" && Array.isArray(value)) {
      out[key] = value.map(scrubReplayEvent);
    } else {
      out[key] = scrubUrls(value, key, 0);
    }
  }
  return out;
}

function scrubRecord(record: Properties): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = scrubUrls(value, key, 0);
  }
  return out;
}

function scrubUrls(value: unknown, key: string, depth: number): unknown {
  if (typeof value === "string") {
    return URL_KEY.test(key) ? stripUrlQuery(value) : value;
  }
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubUrls(item, key, depth + 1));
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = scrubUrls(v, k, depth + 1);
  }
  return out;
}

// `$elements_chain` is PostHog's flattened element path, e.g.
// `a.btn:attr__href="/x?y=1"href="/x?y=1"nth-child="1"`. Values escape `"`
// as `\"`; a trailing backslash left by the cut would escape the closing quote.
function stripChainHrefs(chain: string): string {
  return chain.replace(
    /href="((?:[^"\\]|\\.)*)"/g,
    (_match, value: string) =>
      `href="${stripUrlQuery(value).replace(/\\+$/, "")}"`,
  );
}

// Heatmap points are bucketed by page URL.
function foldHeatmapUrls(data: Record<string, unknown>) {
  const out: Record<string, unknown[]> = {};
  for (const [url, points] of Object.entries(data)) {
    const bare = stripUrlQuery(url);
    out[bare] = (out[bare] ?? []).concat(points);
  }
  return out;
}

// Session replay: the page URL in Meta events, PostHog's $url_changed and
// $pageview markers, and network-timing entries named by request URL.
// DOM snapshots are left alone (their text is governed by replay masking).
function scrubReplayEvent(event: unknown): unknown {
  if (!isRecord(event) || !isRecord(event.data)) return event;
  const { data } = event;
  if (event.type === REPLAY_META || event.type === REPLAY_CUSTOM) {
    return { ...event, data: scrubUrls(data, "", 0) };
  }
  if (
    event.type === REPLAY_PLUGIN &&
    isRecord(data.payload) &&
    Array.isArray(data.payload.requests)
  ) {
    const requests = data.payload.requests.map((request: unknown) =>
      isRecord(request) && typeof request.name === "string"
        ? { ...request, name: stripUrlQuery(request.name) }
        : request,
    );
    return {
      ...event,
      data: { ...data, payload: { ...data.payload, requests } },
    };
  }
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
