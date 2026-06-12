"use client";

import { gateway } from "@/gateway";
import { useConvexAuth, useQuery } from "convex/react";

// Shared auth-gated member lookup for the dashboard sections. Every section
// needs the Convex member to scope its reads; Convex deduplicates identical
// subscriptions so each section can call this independently.
export function useCurrentMember() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const member = useQuery(
    gateway.identity.currentUser,
    isLoading || !isAuthenticated ? "skip" : {},
  );
  return {
    member,
    // True until we know whether a member document exists.
    isMemberLoading: isLoading || (isAuthenticated && member === undefined),
  };
}
