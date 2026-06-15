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

// Reject a promise if it doesn't settle within `ms`, so no step in the subscribe pipeline can hang
// the UI indefinitely; the label tells us WHICH step stalled.
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

// Register (or reuse) the root-scoped service worker that receives pushes.
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js");
}

// Wait until the registration has an ACTIVE worker (pushManager.subscribe needs one). Unlike
// `navigator.serviceWorker.ready` — which hangs forever if the worker never activates (e.g. /sw.js
// served as HTML, a parse error, or it goes redundant) — this resolves on activation, REJECTS with a
// clear message if the worker becomes redundant, and times out instead of hanging.
function waitForActiveWorker(
  registration: ServiceWorkerRegistration,
  timeoutMs = 10000,
): Promise<void> {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Service worker did not activate in time")),
      timeoutMs,
    );
    const check = () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve();
      } else if (worker.state === "redundant") {
        clearTimeout(timer);
        reject(
          new Error("Service worker failed to install (became redundant)"),
        );
      }
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

// Subscribe this browser to push with the given VAPID public key, returning the storable payload.
// Reuses an existing subscription if present (idempotent), and recovers from a stale subscription
// created with a different VAPID key (which would otherwise make subscribe throw InvalidStateError).
export async function subscribeToPush(
  vapidPublicKey: string,
): Promise<PushSubscriptionPayload> {
  // Breadcrumbs: if any step stalls, the console shows the last line reached, pinpointing the cause.
  console.debug("[push] register service worker…");
  const registration = await withTimeout(
    registerServiceWorker(),
    10000,
    "register service worker",
  );
  console.debug("[push] wait for active worker…");
  await waitForActiveWorker(registration);
  console.debug("[push] read existing subscription…");
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    console.debug("[push] reusing existing subscription");
    return subscriptionToPayload(existing);
  }

  const options: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  };
  const subscribe = () =>
    withTimeout(
      registration.pushManager.subscribe(options),
      15000,
      "PushManager.subscribe",
    );
  try {
    console.debug("[push] subscribe via PushManager…");
    const sub = await subscribe();
    console.debug("[push] subscribed");
    return subscriptionToPayload(sub);
  } catch (error) {
    // A stale subscription created with a different VAPID key makes subscribe throw
    // InvalidStateError; drop it and retry once.
    if (error instanceof DOMException && error.name === "InvalidStateError") {
      console.debug("[push] stale subscription; unsubscribe + retry…");
      const stale = await registration.pushManager.getSubscription();
      if (stale) await stale.unsubscribe();
      return subscriptionToPayload(await subscribe());
    }
    throw error;
  }
}

// The service-worker registration controlling this origin, or null. Prefers the registration for the
// current page scope and falls back to scanning all registrations, so it works regardless of which
// page the call is made from (more robust than passing a clientURL).
async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const byScope = await navigator.serviceWorker.getRegistration();
  if (byScope) return byScope;
  const all = await navigator.serviceWorker.getRegistrations();
  return all[0] ?? null;
}

// Tear down this browser's subscription, returning its endpoint (so the caller can unregister it
// server-side), or null if there was none.
export async function unsubscribeFromPush(): Promise<string | null> {
  const registration = await getPushRegistration();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

// The current subscription's endpoint, or null. Used to show whether THIS browser is subscribed.
export async function currentSubscriptionEndpoint(): Promise<string | null> {
  const registration = await getPushRegistration();
  if (!registration) return null;
  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
