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
    case "exchange_proposed":
    case "exchange_disputed":
      return "/trades";
    case "message_received":
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
    default:
      return "/notifications";
  }
};

// Map a delivered notification's facts to the SW payload (+ click URL). Centralised so the action
// and the tests agree on the wire shape.
export const toWebPushPayload = (n: {
  title: string;
  message: string;
  type: string;
  relatedId?: string;
}): WebPushPayload => ({
  title: n.title,
  body: n.message,
  type: n.type,
  relatedId: n.relatedId,
  url: notificationUrl(n.type, n.relatedId),
});
