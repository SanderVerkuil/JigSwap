import { useAuth } from "@/compat/clerk";
import { pushSupported, unsubscribeFromPush } from "@/lib/web-push";
import { useEffect } from "react";

// A signed-out browser must not keep receiving a member's push (SEC-54). The user menu's Sign out
// tears push down itself; this catches every other way a session ends: expiry, signing out in
// another tab or from another device, Clerk's own account pages. Once signed out the server can't
// be told, so only the browser's subscription is dropped; the push channel prunes the server row
// when the push service answers 410 Gone on the next send.
export function PushSignOutGuard(): null {
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || isSignedIn || !pushSupported()) return;
    unsubscribeFromPush().catch((error: unknown) =>
      console.warn("[push] signed-out teardown failed:", error),
    );
  }, [isLoaded, isSignedIn]);

  return null;
}
