"use client";

// Shell preferences persisted on the CLERK USER (client-writable
// `unsafeMetadata.shellPrefs`) rather than localStorage, so they follow the
// account across devices and surface inside Clerk's own profile UI. The hook's
// public shape — `{ fullWidth, hideEmail, setPreference }` — is unchanged, so
// shell.tsx / user-footer don't need to know where the values live.
//
// Reads come straight from `useUser()`; writes use `user.updateMetadata({
// unsafeMetadata: { shellPrefs } })` (deep-merge, so other unsafeMetadata keys
// survive). We layer an optimistic local override on top so toggles feel
// instant, then let Clerk's reconciled value take over once the round-trip
// resolves. While the user is loading / signed out (incl. SSR first paint) we
// fall back to DEFAULTS so nothing flashes or throws.

import { useUser } from "@/compat/clerk";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ShellPreferences = {
  /** Stretch page content edge to edge (true) or center it at ~1180px. */
  fullWidth: boolean;
  /** Blur the email address in the sidebar user footer. */
  hideEmail: boolean;
};

// Prototype tweak defaults: fullWidth on, hideEmail on. Used while the user is
// loading or unauthenticated so SSR / first paint stay stable.
const DEFAULTS: ShellPreferences = { fullWidth: true, hideEmail: true };

// The slice of `user.unsafeMetadata` we own. Kept under a single namespaced key
// so we never clobber metadata written by other features.
const METADATA_KEY = "shellPrefs";

function readStoredPrefs(
  unsafeMetadata: Record<string, unknown> | undefined,
): Partial<ShellPreferences> {
  const raw = unsafeMetadata?.[METADATA_KEY];
  if (!raw || typeof raw !== "object") return {};
  const { fullWidth, hideEmail } = raw as Record<string, unknown>;
  const prefs: Partial<ShellPreferences> = {};
  if (typeof fullWidth === "boolean") prefs.fullWidth = fullWidth;
  if (typeof hideEmail === "boolean") prefs.hideEmail = hideEmail;
  return prefs;
}

// ---- React context ------------------------------------------------------

type SetPreference = <K extends keyof ShellPreferences>(
  key: K,
  value: ShellPreferences[K],
) => void;

type ShellPreferencesContextValue = ShellPreferences & {
  setPreference: SetPreference;
};

const ShellPreferencesContext =
  createContext<ShellPreferencesContextValue | null>(null);

export function ShellPreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoaded } = useUser();

  // Optimistic overrides applied on top of Clerk's stored value so toggles are
  // snappy even before the metadata write round-trips back.
  const [overrides, setOverrides] = useState<Partial<ShellPreferences>>({});

  const stored = readStoredPrefs(
    user?.unsafeMetadata as Record<string, unknown> | undefined,
  );

  const { fullWidth, hideEmail }: ShellPreferences = {
    ...DEFAULTS,
    ...stored,
    ...overrides,
  };

  const setPreference = useCallback<SetPreference>(
    (key, value) => {
      // Optimistic local state first for an instant UI response.
      setOverrides((prev) => ({ ...prev, [key]: value }));

      // Guard the SSR / unauthenticated case: with no Clerk user there is
      // nothing to persist to, so the optimistic value is all we have.
      if (!isLoaded || !user) return;

      const nextPrefs: ShellPreferences = {
        ...DEFAULTS,
        ...readStoredPrefs(
          user.unsafeMetadata as Record<string, unknown> | undefined,
        ),
        [key]: value,
      };

      // Deep-merge into unsafeMetadata; leaves any sibling metadata untouched.
      void user
        .updateMetadata({ unsafeMetadata: { [METADATA_KEY]: nextPrefs } })
        .then(() => {
          // Reconciled: Clerk's value now matches, drop the local override so
          // the stored value is the single source of truth.
          setOverrides((prev) => {
            const { [key]: _omit, ...rest } = prev;
            return rest;
          });
        })
        .catch(() => {
          // Persisting failed; keep the optimistic value in place so the UI
          // still reflects the user's intent for this session.
        });
    },
    [isLoaded, user],
  );

  const value = useMemo<ShellPreferencesContextValue>(
    () => ({ fullWidth, hideEmail, setPreference }),
    [fullWidth, hideEmail, setPreference],
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
