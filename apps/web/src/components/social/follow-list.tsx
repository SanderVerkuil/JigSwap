"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { gateway } from "@/gateway";
import { useQuery } from "convex/react";

// A followers or following list for the acting member. The query resolves each counterparty's
// display name server-side; here we only render the FollowEdgeView entries.
export function FollowList({
  variant,
  emptyHint,
}: {
  variant: "followers" | "following";
  emptyHint: string;
}) {
  const edges = useQuery(
    variant === "followers"
      ? gateway.social.followers
      : gateway.social.following,
    {},
  );

  if (edges === undefined) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Loading...
        </CardContent>
      </Card>
    );
  }

  if (edges.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {emptyHint}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y">
        {edges.map((edge) => (
          <li
            key={edge.followId ?? edge.memberId}
            className="flex items-center gap-3 px-4 py-3"
          >
            <Avatar className="h-8 w-8">
              <AvatarFallback>
                {edge.displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{edge.displayName}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
