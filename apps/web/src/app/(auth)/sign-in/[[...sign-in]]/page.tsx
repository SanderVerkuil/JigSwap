import { HeaderLogo } from "@/components/common/header-logo";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center bg-background min-h-svh">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex justify-center">
            <HeaderLogo className="pl-0 h-16" />
          </div>
          <p className="mt-2 text-muted-foreground">
            Welcome back to the puzzle trading community
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "shadow-lg",
            },
          }}
        />
      </div>
    </div>
  );
}
