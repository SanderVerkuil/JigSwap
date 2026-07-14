"use client";

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useLocale } from "use-intl";

// Emails localize from `users.preferredLanguage` (hardcoded "en" at account
// creation, otherwise only ever written by the profile editor's language
// field). The app's actual UI language instead lives in the `jigswap-intl`
// cookie (apps/web/src/lib/i18n.ts) set by whichever language switcher the
// member used, so the two silently diverge and outbound emails never match
// what the member reads the app in. Mounted once in the dashboard shell, this
// null-rendering component reconciles them: whenever the signed-in member is
// known and their `preferredLanguage` differs from the active `useLocale()`,
// it pushes the app locale into the backend. Switcher-agnostic (works no
// matter which UI wrote the cookie) and self-healing — accounts created
// before this fix converge to the correct locale on their next app load.
export function SyncPreferredLanguage() {
  const locale = useLocale();
  const { member } = useCurrentMember();
  const { mutateAsync: updateProfile } = useMutation({
    mutationFn: useConvexMutation(gateway.identity.updateProfile),
  });

  // Remembers the last locale we attempted to sync so a slow reactive
  // round-trip (member.preferredLanguage hasn't caught up to the write yet)
  // can't fire the mutation twice for the same mismatch. A failed sync isn't
  // retried until the locale changes again or the component remounts.
  const lastSyncedLocale = useRef<string | null>(null);

  useEffect(() => {
    if (!member) return;
    if (member.preferredLanguage === locale) return;
    if (lastSyncedLocale.current === locale) return;
    lastSyncedLocale.current = locale;
    // Fire-and-forget: only preferredLanguage is sent (bio/location are
    // optional args the backend patch leaves untouched when absent), and a
    // sync failure must never surface to the user.
    updateProfile({ preferredLanguage: locale }).catch(() => {});
  }, [locale, member, updateProfile]);

  return null;
}
