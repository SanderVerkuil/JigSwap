"use client";

import { Button } from "@/components/ui/button";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// Follow/unfollow toggle for a target member. Reads the live follow state from the gateway and
// flips it; disabled while a mutation is in flight. The acting member is derived server-side.
// `size` lets compact contexts (e.g. member tiles) render the small button variant.
export function FollowButton({
  memberId,
  size = "default",
}: {
  memberId: Id<"users">;
  size?: "default" | "sm";
}) {
  const following = useQuery(gateway.social.isFollowing, {
    followeeId: memberId,
  });
  const follow = useMutation(gateway.social.follow);
  const unfollow = useMutation(gateway.social.unfollow);
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);
    try {
      if (following) {
        await unfollow({ followeeId: memberId });
        toast.success("Unfollowed");
      } else {
        await follow({ followeeId: memberId });
        toast.success("Following");
      }
    } catch {
      toast.error("Could not update follow status");
    } finally {
      setPending(false);
    }
  };

  if (following === undefined) {
    return (
      <Button variant="outline" size={size} disabled>
        <UserPlus className="mr-2 h-4 w-4" />
        Follow
      </Button>
    );
  }

  return (
    <Button
      variant={following ? "outline" : "default"}
      size={size}
      onClick={handleClick}
      disabled={pending}
    >
      {following ? (
        <>
          <UserMinus className="mr-2 h-4 w-4" />
          Unfollow
        </>
      ) : (
        <>
          <UserPlus className="mr-2 h-4 w-4" />
          Follow
        </>
      )}
    </Button>
  );
}
