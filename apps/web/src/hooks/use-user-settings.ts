import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";

// Reads the member's federated settings and exposes the solving duration preference + its setter.
// `trackCompletionDuration` is undefined until first chosen; the dialogs use that to decide whether
// to show the secondary first-time prompt. `isLoading` guards the initial fetch.
export function useUserSettings() {
  const { data: settings, isPending } = useQuery(
    convexQuery(gateway.settings.mine, {}),
  );
  const { mutateAsync: setTrackDuration } = useMutation({
    mutationFn: useConvexMutation(gateway.solving.setTrackCompletionDuration),
  });
  return {
    isLoading: isPending || settings === undefined,
    trackCompletionDuration: settings?.solving.trackCompletionDuration,
    setTrackDuration: (enabled: boolean) => setTrackDuration({ enabled }),
  };
}
