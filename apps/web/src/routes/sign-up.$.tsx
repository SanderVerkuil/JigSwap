import { SignUp } from "@/compat/clerk";
import { AuthShell } from "@/components/auth/auth-shell";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

// Catch-all so Clerk's multi-step sign-up sub-routes resolve here, mirroring
// web's (auth)/sign-up/[[...sign-up]].
export const Route = createFileRoute("/sign-up/$")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "signUp") }],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <AuthShell>
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
