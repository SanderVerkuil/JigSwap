import { SignUp } from "@/compat/clerk";
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
    <div className="flex items-center justify-center bg-background min-h-svh">
      <div className="w-full max-w-md">
        {/* Explicit redirect_url query params (set by lib/require-auth.ts) still
            win; this only changes the no-param fallback from / to /dashboard. */}
        <SignUp
          appearance={{ elements: { rootBox: "mx-auto", card: "shadow-lg" } }}
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
