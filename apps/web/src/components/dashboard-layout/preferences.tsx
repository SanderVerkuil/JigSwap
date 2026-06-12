"use client";

// Lightweight, localStorage-persisted shell preferences. There is no backend
// preferences API, so this deliberately stays client-local. The store is a
// tiny module-level external store consumed via useSyncExternalStore: the
// server snapshot is the defaults (so SSR/hydration markup always match) and
// React swaps in the stored values right after hydration.

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type ShellPreferences = {
  /** Stretch page content edge to edge (true) or center it at ~1180px. */
  fullWidth: boolean;
  /** Blur the email address in the sidebar user footer. */
  hideEmail: boolean;
};

// Prototype tweak defaults: fullWidth on, hideEmail on.
const DEFAULTS: ShellPreferences = { fullWidth: true, hideEmail: true };

const STORAGE_KEY = "jigswap-shell-preferences";

// ---- Module-level store -----------------------------------------------

let snapshot: ShellPreferences = DEFAULTS;
const listeners = new Set<() => void>();

function loadSnapshot() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    snapshot = raw
      ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ShellPreferences>) }
      : DEFAULTS;
  } catch {
    // Corrupt/inaccessible storage: keep the defaults.
    snapshot = DEFAULTS;
  }
}

if (typeof window !== "undefined") {
  loadSnapshot();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Stay in sync when another tab changes the stored preferences.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      loadSnapshot();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ShellPreferences {
  return snapshot;
}

function getServerSnapshot(): ShellPreferences {
  return DEFAULTS;
}

function setPreference<K extends keyof ShellPreferences>(
  key: K,
  value: ShellPreferences[K],
) {
  snapshot = { ...snapshot, [key]: value };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persisting is best-effort; the in-memory value still applies.
  }
  for (const listener of listeners) {
    listener();
  }
}

// ---- React context ------------------------------------------------------

type ShellPreferencesContextValue = ShellPreferences & {
  setPreference: typeof setPreference;
};

const ShellPreferencesContext =
  createContext<ShellPreferencesContextValue | null>(null);

export function ShellPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const preferences = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const value = useMemo(
    () => ({ ...preferences, setPreference }),
    [preferences],
  );

  return (
    <ShellPreferencesContext.Provider value={value}>
      {children}
    </ShellPreferencesContext.Provider>
  );
}

export function useShellPreferences(): ShellPreferencesContextValue {
  const context = useContext(ShellPreferencesContext);
  if (!context) {
    throw new Error(
      "useShellPreferences must be used within a ShellPreferencesProvider.",
    );
  }
  return context;
}
