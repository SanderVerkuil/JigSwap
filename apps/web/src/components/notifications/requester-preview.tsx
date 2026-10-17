"use client";

import { Link } from "@/compat/link";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Globe, Lock } from "lucide-react";
import { useId, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

/**
 * "View profile" disclosure on a pending follow request: the minimal identity the server lets the
 * recipient see while the request is open (followRequesterPreview), fetched only when expanded.
 * Renders nothing once the server says the request is no longer pending (null).
 */
export function RequesterPreview({
  requesterId,
  actorName,
}: {
  requesterId: string;
  actorName: string;
}) {
  const t = useTranslations("notifications.rich.requester");
  const displayName = useMemberDisplayName();
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { data: preview } = useQuery(
    convexQuery(
      gateway.social.followRequesterPreview,
      open ? { requesterId: requesterId as Id<"users"> } : "skip",
    ),
  );

  return (
    <div className="relative z-10">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="text-muted-foreground h-auto px-0 py-0.5 text-xs pointer-coarse:min-h-11"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("viewProfileAria", { actor: actorName })}
        onClick={() => setOpen((value) => !value)}
      >
        {t("viewProfile")}
        <ChevronDown
          aria-hidden="true"
          className={
            open
              ? "size-3.5 rotate-180 transition-transform motion-reduce:transition-none"
              : "size-3.5 transition-transform motion-reduce:transition-none"
          }
        />
      </Button>
      <div id={panelId} hidden={!open}>
        {open && preview === undefined && (
          <Skeleton className="mt-1 h-14 w-full max-w-xs" />
        )}
        {open && preview && (
          <div className="bg-muted/50 mt-1 flex max-w-sm flex-wrap items-center gap-3 rounded-lg border p-3">
            <Avatar className="size-10">
              {preview.avatar && <AvatarImage src={preview.avatar} alt="" />}
              <AvatarFallback className="text-sm font-semibold">
                <MemberInitial source={{ name: preview.displayName }} />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 text-xs">
              <p className="text-foreground truncate text-sm font-semibold">
                {displayName({ name: preview.displayName })}
              </p>
              {preview.handle !== preview.memberId && (
                <p className="text-muted-foreground truncate">
                  @{preview.handle}
                </p>
              )}
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-2">
                <span>
                  {t("memberSince", {
                    date: format.dateTime(preview.memberSince, {
                      year: "numeric",
                      month: "long",
                    }),
                  })}
                </span>
                <span className="inline-flex items-center gap-1">
                  {preview.visibility === "private" ? (
                    <Lock className="size-3" aria-hidden="true" />
                  ) : (
                    <Globe className="size-3" aria-hidden="true" />
                  )}
                  {preview.visibility === "private"
                    ? t("private")
                    : t("public")}
                </span>
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="pointer-coarse:h-11 max-sm:w-full"
            >
              <Link href={`/members/${encodeURIComponent(preview.handle)}`}>
                {t("openProfile")}
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
