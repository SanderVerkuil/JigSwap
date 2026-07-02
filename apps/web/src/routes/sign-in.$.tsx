import { SignIn } from "@/compat/clerk";
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
    <div className="flex items-center justify-center bg-background min-h-svh">
      <div className="w-full max-w-md">
        {/* Explicit redirect_url query params (set by lib/require-auth.ts) still
            win; this only changes the no-param fallback from / to /dashboard. */}
        <SignIn
          appearance={{ elements: { rootBox: "mx-auto", card: "shadow-lg" } }}
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
