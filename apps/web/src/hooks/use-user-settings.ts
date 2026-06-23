import { gateway } from "@/gateway";
import { useMutation, useQuery } from "convex/react";

// Reads the member's federated settings and exposes the solving duration preference + its setter.
// `trackCompletionDuration` is undefined until first chosen; the dialogs use that to decide whether
// to show the secondary first-time prompt. `isLoading` guards the initial fetch.
export function useUserSettings() {
  const settings = useQuery(gateway.settings.mine, {});
  const setTrackDuration = useMutation(
    gateway.solving.setTrackCompletionDuration,
  );
  return {
    isLoading: settings === undefined,
    trackCompletionDuration: settings?.solving.trackCompletionDuration,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
  };
}
