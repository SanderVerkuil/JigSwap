// Web Storage access can THROW SecurityError (not merely return null) when storage is blocked —
// private/incognito mode and in-app browsers (which the invite flow treats as first-class). Even
// reading the `window.localStorage` PROPERTY can throw, so a bare access inside an effect crashes
// the route to its error boundary. These wrappers swallow the failure so callers degrade gracefully
// (invite attribution is simply lost; the designed fallback nudge covers it).
type StorageKind = "local" | "session";

const store = (kind: StorageKind): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export const safeStorage = {
  getItem(kind: StorageKind, key: string): string | null {
    try {
      return store(kind)?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(kind: StorageKind, key: string, value: string): void {
    try {
      store(kind)?.setItem(key, value);
    } catch {
      // storage unavailable — ignore
    }
  },
  removeItem(kind: StorageKind, key: string): void {
    try {
      store(kind)?.removeItem(key);
    } catch {
      // storage unavailable — ignore
    }
  },
};
