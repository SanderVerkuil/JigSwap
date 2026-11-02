"use client";

import { useAuth } from "@/compat/clerk";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";

// Shared auth-gated member lookup for the dashboard sections. Every section
// needs the Convex member to scope its reads; Convex deduplicates identical
// subscriptions so each section can call this independently.
//
// Follows Clerk's session rather than Convex's auth state, because Clerk's is known during SSR and
// hydration: that is what lets a server-loaded member render in the first paint. Nothing reads as
// nobody meanwhile: on a signed-in page the Convex socket holds its reads until the token is in
// (holdConvexUntilAuth), and this read answers null for a token Convex then refuses.
export function useCurrentMember() {
  const { isSignedIn } = useAuth();
  const { data: member } = useQuery(
    convexQuery(gateway.identity.currentUser, isSignedIn ? {} : "skip"),
  );
  return {
    member,
    // True until we know whether a member document exists.
    isMemberLoading: Boolean(isSignedIn) && member === undefined,
  };
}
