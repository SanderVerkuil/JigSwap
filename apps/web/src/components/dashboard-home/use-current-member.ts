"use client";

import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useConvexAuth } from "convex/react";

// Shared auth-gated member lookup for the dashboard sections. Every section
// needs the Convex member to scope its reads; Convex deduplicates identical
// subscriptions so each section can call this independently.
export function useCurrentMember() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { data: member } = useQuery(
    convexQuery(
      gateway.identity.currentUser,
      isLoading || !isAuthenticated ? "skip" : {},
    ),
  );
  return {
    member,
    // True until we know whether a member document exists.
    isMemberLoading: isLoading || (isAuthenticated && member === undefined),
  };
}
