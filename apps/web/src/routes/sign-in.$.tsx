import { SignIn } from "@/compat/clerk";
import { createFileRoute } from "@tanstack/react-router";

// Catch-all so Clerk's multi-step sign-in sub-routes (/sign-in/factor-one, ...)
// resolve here, mirroring web's (auth)/sign-in/[[...sign-in]].
export const Route = createFileRoute("/sign-in/$")({
  component: SignInPage,
});

function SignInPage() {
  return (
    <div className="flex items-center justify-center bg-background min-h-svh">
      <div className="w-full max-w-md">
        <SignIn
          appearance={{ elements: { rootBox: "mx-auto", card: "shadow-lg" } }}
        />
      </div>
    </div>
  );
}
