import { SignIn } from "@/compat/clerk";
import { authAppearance, AuthField } from "@/components/marketing/auth-field";
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
    <AuthField>
      {/* Explicit redirect_url query params (set by lib/require-auth.ts) still
          win; this only changes the no-param fallback from / to /dashboard. */}
      <SignIn appearance={authAppearance} fallbackRedirectUrl="/dashboard" />
    </AuthField>
  );
}
