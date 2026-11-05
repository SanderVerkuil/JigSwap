import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";

// Reads the member's federated settings and exposes the solving preferences (duration tracking +
// in-progress sharing) with their setters. Both are undefined until first chosen; the solve
// dialogs ask for a time unless `trackCompletionDuration` is false, and offer to turn it off while
// it is undefined. `isLoading` guards the initial fetch.
export function useUserSettings() {
  const { data: settings, isPending } = useQuery(
    convexQuery(gateway.settings.mine, {}),
  );
  const { mutateAsync: setTrackDuration } = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setTrackCompletionDuration),
  });
  const { mutateAsync: setShare } = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setShareInProgress),
  });
  return {
    isLoading: isPending || settings === undefined,
    trackCompletionDuration: settings?.solving.trackCompletionDuration,
    shareInProgress: settings?.solving.shareInProgress,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
    setShareInProgress: (enabled: boolean) => setShare({ enabled }),
  };
}
