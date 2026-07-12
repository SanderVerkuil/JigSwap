import { useAuth } from "@clerk/tanstack-react-start";
import * as React from "react";

// @clerk/nextjs compat: @clerk/tanstack-react-start (re-exporting @clerk/react)
// ships SignInButton/SignOutButton/SignUpButton/UserButton/RedirectToSignIn,
// SignIn/SignUp, useAuth/useUser/useClerk — but NOT SignedIn/SignedOut.
// We shim those two and re-export everything else so ported components import
// all Clerk things from "@/compat/clerk".

// Gate children on an authenticated session; render nothing until Clerk loads
// to avoid a flash of signed-in content during hydration.
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <>{children}</> : null;
}

// Inverse of SignedIn.
export function SignedOut({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? null : <>{children}</>;
}

export {
  ClerkProvider,
  RedirectToSignIn,
  SignIn,
  SignInButton,
  SignOutButton,
  SignUp,
  SignUpButton,
  useAuth,
  useClerk,
  UserButton,
  useReverification,
  UserProfile,
  useUser,
} from "@clerk/tanstack-react-start";

// Reverification helpers live on the /errors subpath. `isReverificationCancelledError`
// distinguishes the user closing the step-up modal from a genuine failure.
export { isReverificationCancelledError } from "@clerk/tanstack-react-start/errors";
