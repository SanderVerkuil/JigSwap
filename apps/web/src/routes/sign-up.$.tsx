import { SignUp } from "@/compat/clerk";
import { AuthShell } from "@/components/auth/auth-shell";
import { InviteSignUpNote } from "@/components/social/invite-sign-up-note";
import { pageTitle } from "@/lib/page-title";
import { isSharedCopyHref } from "@/lib/shared-copy-link";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// Catch-all so Clerk's multi-step sign-up sub-routes resolve here, mirroring
// web's (auth)/sign-up/[[...sign-up]].
export const Route = createFileRoute("/sign-up/$")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "signUp") }],
  }),
  component: SignUpPage,
});

// Says why a stranger followed a member's puzzle link to a sign-up card.
function SharedPuzzleNote() {
  const t = useTranslations("auth");
  return (
    <p className="text-muted-foreground mb-4 text-center text-sm">
      {t("sharedPuzzle")}
    </p>
  );
}

function SignUpPage() {
  const redirectUrl = useLocation({
    select: (location) =>
      (location.search as { redirect_url?: unknown }).redirect_url,
  });
  return (
    <AuthShell>
      {isSharedCopyHref(redirectUrl) && <SharedPuzzleNote />}
      <InviteSignUpNote redirectUrl={redirectUrl} />
      {/* Explicit redirect_url query params (set by lib/require-auth.ts) still
          win; this only changes the no-param fallback from / to /dashboard.
          signInUrl keeps the card's footer link on our own sign-in page;
          without it Clerk links to the instance's hosted Account Portal,
          which has no way back to JigSwap. */}
      <SignUp
        appearance={{ elements: { rootBox: "mx-auto", card: "shadow-lg" } }}
        fallbackRedirectUrl="/dashboard"
        signInUrl="/sign-in"
      />
    </AuthShell>
  );
}
