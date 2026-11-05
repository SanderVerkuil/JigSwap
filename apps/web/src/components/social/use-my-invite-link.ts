import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { inviteLandingUrl } from "./invite-share";

// The member's own invite link, fetched when the surface mounts: social.myInviteLink is a mutation
// because it mints the link on first use. It needs no username or custom link: the URL is the
// stable member-id address. `url` is null until it arrives; `failed` says it didn't, and `refetch`
// asks again (after a reset, too, since the old token stops working).
export function useMyInviteLink(memberId: string) {
  const {
    mutate: fetchLink,
    data: link,
    isError,
  } = useMutation({
    mutationFn: useConvexMutation(gateway.social.myInviteLink),
  });
  useEffect(() => {
    fetchLink({});
  }, [fetchLink]);
  return {
    // Only set after a client-side mutation, so `window` is defined here.
    url: link
      ? inviteLandingUrl(window.location.origin, memberId, link.token)
      : null,
    failed: isError,
    refetch: () => fetchLink({}),
  };
}
