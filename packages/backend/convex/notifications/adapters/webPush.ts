// Pluggable web-push port + pure helpers. This module imports NEITHER Convex ctx NOR the `web-push`
// library (which needs the Node runtime), so the payload/URL/decision logic is unit-testable with a
// plain fake. The REAL sender — which signs VAPID JWTs and encrypts the payload via `web-push` — is
// built in the "use node" action `notifications/sendWebPush.ts`.
//
// ENV (per Convex deployment):
//   VAPID_PUBLIC_KEY  — base64url VAPID public key (also served to the client via getPushConfig).
//   VAPID_PRIVATE_KEY — base64url VAPID private key.
//   VAPID_SUBJECT     — "mailto:you@example.com" (or a site URL); identifies the sender to push
//                       services. Optional; defaults to DEFAULT_SUBJECT.
// When the public or private key is missing the feature is OFF: the sender fails OPEN (logs + no-op),
// so push ships disabled-by-default and the operator opts in by setting the keys.

// The decrypted subscription keys a push service needs, as stored in `pushSubscriptions`.
export interface PushSubscriptionData {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

// The JSON the service worker receives in its `push` event and renders into a Notification.
export interface WebPushPayload {
  readonly title: string;
  readonly body: string;
  readonly type: string;
  readonly url: string; // where notificationclick navigates
  readonly relatedId?: string;
  // The OS notification tag: a later push with the same tag replaces the shown one.
  readonly tag: string;
}

// Outcome of ONE send. `gone` flags a permanently-dead subscription (404/410) the caller must prune;
// any other failure is transient and merely logged (the in-app row already persisted regardless).
export interface WebPushSendResult {
  readonly ok: boolean;
  readonly gone: boolean;
  readonly statusCode: number | null;
  readonly error?: string;
}

// Outbound port. An adapter delivers ONE payload to ONE subscription. Implementations must NEVER
// throw for a benign/transient failure — they return a result and let the caller decide.
export interface WebPushSender {
  send(
    sub: PushSubscriptionData,
    payload: WebPushPayload,
  ): Promise<WebPushSendResult>;
}

export interface VapidConfig {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export const DEFAULT_SUBJECT = "mailto:hello@jigswap.site";

// Read VAPID config from env; null when the keypair is not fully configured (push disabled).
export const vapidConfigFromEnv = (
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null => {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: env.VAPID_SUBJECT ?? DEFAULT_SUBJECT,
  };
};

// A sender that does nothing (push not configured / disabled): logs once and reports a benign no-op
// that never asks the caller to prune.
export const noopWebPushSender = (reason: string): WebPushSender => ({
  async send() {
    console.warn(`web-push disabled (${reason}); dropping push notification.`);
    return { ok: false, gone: false, statusCode: null };
  },
});

// What a member may register (notifications/pushSubscriptions). The push action POSTs to the stored
// endpoint, so it must be a browser push service, never a host or port the member picked.
export const MAX_PUSH_ENDPOINT_LENGTH = 2048;
// Subscriptions kept per member: registering one more evicts the oldest.
export const MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER = 10;

// Chrome, Edge (Chromium), Brave, Opera, Samsung: FCM (android.googleapis.com is its legacy GCM
// name). Firefox: Mozilla autopush. Safari: Apple. Legacy Edge: WNS. A refused registration logs
// its host, so a missing service shows up in the logs.
const PUSH_SERVICE_HOSTS: readonly string[] = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];
const PUSH_SERVICE_HOST_SUFFIXES: readonly string[] = [
  ".push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
];

const isPushServiceHost = (host: string): boolean =>
  PUSH_SERVICE_HOSTS.includes(host) ||
  PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));

// Printable ASCII, no spaces: what push services hand out.
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

// True when `endpoint` is an https URL on a browser push service: no explicit port, no userinfo, at
// most MAX_PUSH_ENDPOINT_LENGTH characters. The raw string must start with exactly
// "https://<host>/", so web-push's legacy url.parse reads the same host the check approved.
export const isAllowedPushEndpoint = (endpoint: string): boolean => {
  if (
    endpoint.length > MAX_PUSH_ENDPOINT_LENGTH ||
    !PRINTABLE_ASCII.test(endpoint)
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    isPushServiceHost(url.hostname) &&
    endpoint.startsWith(`https://${url.hostname}/`)
  );
};

// The host of a refused endpoint, for the log line (never the path: it carries the device token).
export const pushEndpointHost = (endpoint: string): string | null => {
  try {
    return new URL(endpoint).hostname.slice(0, 253) || null;
  } catch {
    return null;
  }
};

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

// The bytes of a base64url string (padding optional) as a binary string, or null when it isn't one.
const decodeBase64Url = (value: string): string | null => {
  if (value.length > 128 || !BASE64URL.test(value)) return null;
  const base64 = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return null;
  }
};

// True when the keys are what RFC 8291 encryption needs: p256dh an uncompressed P-256 point (65
// bytes, 0x04 first) and auth a 16-byte secret, both base64url.
export const isValidPushKeys = (keys: {
  readonly p256dh: string;
  readonly auth: string;
}): boolean => {
  const p256dh = decodeBase64Url(keys.p256dh);
  const auth = decodeBase64Url(keys.auth);
  return (
    p256dh !== null &&
    p256dh.length === 65 &&
    p256dh.charCodeAt(0) === 0x04 &&
    auth !== null &&
    auth.length === 16
  );
};

// The subscriptions one push goes to: allowlisted endpoints only, newest first (createdAt), at most
// MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER. Registration enforces both, but rows stored before it did may
// point anywhere or number more; those are skipped here, not deleted.
export const deliverablePushSubscriptions = <
  S extends PushSubscriptionData & { readonly createdAt: number },
>(
  subs: readonly S[],
): S[] =>
  subs
    .filter((sub) => isAllowedPushEndpoint(sub.endpoint))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER);

// The HTTP statuses a push service returns when a subscription is permanently invalid and should be
// deleted rather than retried.
export const isGoneStatus = (status: number): boolean =>
  status === 404 || status === 410;

// Best-effort deep link for a notification type, mirroring the web's notification-meta routing so a
// click lands somewhere sensible. Falls back to the in-app feed, which always resolves the rest.
export const notificationUrl = (type: string, relatedId?: string): string => {
  switch (type) {
    case "trade_request":
    case "trade_accepted":
    case "trade_declined":
    case "trade_completed":
    case "trade_cancelled":
    case "trade_cancelled_member_deleted":
    case "exchange_proposed":
    case "exchange_disputed":
      return "/trades";
    case "message_received":
    case "circle_message_received":
      return "/messages";
    case "review_received":
      return "/profile";
    case "goal_achieved":
      return "/goals";
    case "puzzle_favorited":
    case "puzzle_approved":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    case "puzzle_rejected":
      return "/puzzles";
    // Change-proposal outcomes deep-link to the definition the suggestion targeted.
    case "proposal_approved":
    case "proposal_rejected":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    // Admin review deep links (first /admin destinations in this switch).
    case "admin_proposal_filed":
      return relatedId
        ? `/admin/puzzles/proposals/${relatedId}`
        : "/admin/puzzles/proposals";
    case "admin_definition_submitted":
      return "/admin/moderation";
    // Follow notifications land on the People page, where the requests strip lives.
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
    // Household invites resolve on the Household page (accept/decline lives there).
    case "household_invite_received":
    case "household_invite_accepted":
    case "household_join_request_approved":
      return "/household";
    // Requests to join are answered in the household's Members tab (admin only).
    case "household_join_request_received":
      return "/household?tab=members";
    // A connection offer is answered in the People page's requests area.
    case "connection_offer_received":
      return "/people";
    // Circle invites resolve on the Circles page (C2 adds the invite panel there).
    case "circle_invite_received":
      return relatedId ? `/circles?invite=${relatedId}` : "/circles";
    case "circle_invite_accepted":
    case "circle_deleted":
      return "/circles";
    // What's new: relatedId is the entry id; the page anchors each card as #entry-<id>.
    case "whats_new":
      return relatedId ? `/whats-new#entry-${relatedId}` : "/whats-new";
    default:
      return "/notifications";
  }
};

// Map a delivered notification's facts to the SW payload (+ click URL). Centralised so the action
// and the tests agree on the wire shape. `url` is the resolved in-app deep link
// (notifications/resolveForDelivery); absent or null falls back to the per-type notificationUrl.
export const toWebPushPayload = (n: {
  title: string;
  message: string;
  type: string;
  relatedId?: string;
  url?: string | null;
  subject?: { kind: string; threadId?: string };
}): WebPushPayload => ({
  title: n.title,
  body: n.message,
  type: n.type,
  relatedId: n.relatedId,
  url: n.url ?? notificationUrl(n.type, n.relatedId),
  tag: pushTagOf(n.type, n.subject),
});

// A thread's pushes share `thread:<threadId>`, so the OS shows one notification per thread;
// everything else coalesces per type, as before.
export const pushTagOf = (
  type: string,
  subject?: { kind: string; threadId?: string },
): string =>
  subject?.kind === "thread" && subject.threadId !== undefined
    ? `thread:${subject.threadId}`
    : type;
