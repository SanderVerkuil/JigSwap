import { isSharedCopyHref } from "@/lib/shared-copy-link";
import { redirect } from "@tanstack/react-router";

// beforeLoad guard for protected routes (dashboard/admin in later waves). The
// root beforeLoad already puts userId in context; redirect to Clerk sign-in when
// it's absent, preserving the attempted path as a redirect target. A puzzle link a
// member sent goes to sign-up instead: its visitor usually has no account yet (the
// card's "Sign in" keeps the target for one who does).
export function requireAuth(opts: {
  context: { userId?: string | null };
  location: { href: string };
}) {
  if (!opts.context.userId) {
    throw redirect({
      to: isSharedCopyHref(opts.location.href) ? "/sign-up/$" : "/sign-in/$",
      params: { _splat: "" },
      search: { redirect_url: opts.location.href },
    });
  }
  return { userId: opts.context.userId };
}
