import { SignIn } from "@/compat/clerk";
import { AuthShell } from "@/components/auth/auth-shell";
import { authAppearance } from "@/components/marketing/auth-field";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

// Catch-all so Clerk's multi-step sign-in sub-routes (/sign-in/factor-one, ...)
// resolve here, mirroring web's (auth)/sign-in/[[...sign-in]].
export const Route = createFileRoute("/sign-in/$")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "signIn") }],
  }),
  component: SignInPage,
});

function SignInPage() {
  return (
    <AuthShell>
      {/* Explicit redirect_url query params (set by lib/require-auth.ts) still
          win; this only changes the no-param fallback from / to /dashboard.
          signUpUrl keeps the card's footer link on our own sign-up page;
          without it Clerk links to the instance's hosted Account Portal,
          which has no way back to JigSwap. */}
      <SignIn
        appearance={authAppearance}
        fallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
      />
    </AuthShell>
  );
}
