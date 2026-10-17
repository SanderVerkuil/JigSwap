// Captures Chromium's `beforeinstallprompt` so the in-app "Install app" button can show the
// browser's install dialog later. Imported for its side effect from the root route so the
// listener is attached before the event can fire (it may fire before the dashboard chunk loads).
// Calling preventDefault() swaps Chrome's own mini-infobar for our tip; the browser menu's
// "Install app" item keeps working everywhere.

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

/**
 * Shows the browser's install dialog. A prompt can be used once, so it is dropped either way;
 * Chromium fires `beforeinstallprompt` again later if the member declined.
 */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | null
> {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
