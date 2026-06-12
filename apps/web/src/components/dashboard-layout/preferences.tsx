"use client";

// Lightweight, localStorage-persisted shell preferences. There is no backend
// preferences API, so this deliberately stays client-local: SSR and the first
// client render use the defaults, and the stored values are applied after
// hydration so server and client markup always match.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

type ShellPreferencesContextValue = ShellPreferences & {
  setPreference: <K extends keyof ShellPreferences>(
    key: K,
    value: ShellPreferences[K],
  ) => void;
};

const ShellPreferencesContext =
  createContext<ShellPreferencesContextValue | null>(null);

export function ShellPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState<ShellPreferences>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<ShellPreferences>;
        setPreferences({ ...DEFAULTS, ...stored });
      }
    } catch {
      // Corrupt/inaccessible storage: keep the defaults.
    }
  }, []);

  const setPreference = useCallback(
    <K extends keyof ShellPreferences>(
      key: K,
      value: ShellPreferences[K],
    ) => {
      setPreferences((previous) => {
        const next = { ...previous, [key]: value };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Persisting is best-effort; the in-memory value still applies.
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo(
    () => ({ ...preferences, setPreference }),
    [preferences, setPreference],
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
