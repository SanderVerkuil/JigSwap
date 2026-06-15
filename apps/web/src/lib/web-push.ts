// Client-side Web Push helpers: feature detection, service-worker registration, and turning a
// browser PushSubscription into the { endpoint, p256dh, auth } payload the backend stores. Kept
// framework-free so the push-device card stays thin.

// True when this browser supports the APIs native push needs. SSR-safe (returns false on the server).
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// VAPID public keys are base64url; the PushManager wants the raw bytes. Built over an explicit
// ArrayBuffer (not the generic ArrayBufferLike) so it satisfies the DOM `BufferSource` type that
// applicationServerKey expects (which rejects a possibly-shared backing buffer).
export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// PushSubscription.toJSON() already emits base64url-encoded keys, which is exactly what the
// `web-push` server library decodes — so no manual key conversion is needed.
export function subscriptionToPayload(
  sub: PushSubscription,
): PushSubscriptionPayload {
  const json = sub.toJSON();
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  };
}

// Register (or reuse) the root-scoped service worker that receives pushes.
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

// Subscribe this browser to push with the given VAPID public key, returning the storable payload.
// Reuses an existing subscription if present (idempotent).
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<PushSubscriptionPayload> {
  const registration = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  return subscriptionToPayload(subscription);
}

// Tear down this browser's subscription, returning its endpoint (so the caller can unregister it
// server-side), or null if there was none.
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

// The current subscription's endpoint, or null. Used to show whether THIS browser is subscribed.
export async function currentSubscriptionEndpoint(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
