import { SignUp } from "@/compat/clerk";
import { createFileRoute } from "@tanstack/react-router";

// Catch-all so Clerk's multi-step sign-up sub-routes resolve here, mirroring
// web's (auth)/sign-up/[[...sign-up]].
export const Route = createFileRoute("/sign-up/$")({
  component: SignUpPage,
});

function SignUpPage() {
  return (
    <div className="flex items-center justify-center bg-background min-h-svh">
      <div className="w-full max-w-md">
        <SignUp
          appearance={{ elements: { rootBox: "mx-auto", card: "shadow-lg" } }}
        />
      </div>
    </div>
  );
}
