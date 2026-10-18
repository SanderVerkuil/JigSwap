"use client";

// "Privacy & safety" page inside Clerk's profile modal (shell-user-button): the
// caller's own "Blocked members" list (social/listMyBlocks, newest first), each
// row with Unblock behind a confirm. Self-contained like
// NotificationPreferencesPanel: no route dependencies.
import { useUser } from "@/compat/clerk";
import { MemberInitial } from "@/components/members/member-initial";
import { BlockMemberDialog } from "@/components/social/block-member-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageLoading } from "@/components/ui/loading";
import { gateway, type Id } from "@/gateway";
import { useRelativeTime } from "@/hooks/use-relative-time";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "use-intl";

type BlockedMember = FunctionReturnType<
  typeof gateway.social.listMyBlocks
>[number];

export function PrivacySafetyPanel() {
  const { user } = useUser();
  const t = useTranslations("safety");
  const tShell = useTranslations("shell.user");
  const tCommon = useTranslations("common");
  const displayName = useMemberDisplayName();
  const { data: blocks } = useQuery(
    convexQuery(gateway.social.listMyBlocks, user?.id ? {} : "skip"),
  );

  // One dialog for the list; focus goes back to the row's Unblock button.
  const [target, setTarget] = useState<BlockedMember | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  if (!user || blocks === undefined) {
    return <PageLoading message={tCommon("loading")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">{tShell("privacySafety")}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("blockedMembers")}</h2>
        {blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("blockedEmpty")}</p>
        ) : (
          <ul className="divide-y">
            {blocks.map((block) => (
              <BlockedRow
                key={block.memberId}
                block={block}
                name={displayName(block)}
                onUnblock={(trigger) => {
                  triggerRef.current = trigger;
                  setTarget(block);
                  setOpen(true);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {target && (
        <BlockMemberDialog
          mode="unblock"
          memberId={target.memberId as Id<"users">}
          name={displayName(target)}
          open={open}
          onOpenChange={setOpen}
          returnFocusRef={triggerRef}
        />
      )}
    </div>
  );
}

function BlockedRow({
  block,
  name,
  onUnblock,
}: {
  block: BlockedMember;
  name: string;
  onUnblock: (trigger: HTMLButtonElement) => void;
}) {
  const t = useTranslations("safety");
  const format = useFormatter();
  const relativeTime = useRelativeTime();
  const blockedAt = new Date(block.blockedAt);

  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar className="size-10 shrink-0">
        {block.avatar && <AvatarImage src={block.avatar} alt="" />}
        <AvatarFallback>
          <MemberInitial source={block} />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground text-xs">
          {t.rich("blockedAt", {
            date: relativeTime(blockedAt),
            time: (chunks) => (
              <time
                dateTime={blockedAt.toISOString()}
                title={format.dateTime(blockedAt, { dateStyle: "long" })}
              >
                {chunks}
              </time>
            ),
          })}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-11 shrink-0 md:h-8"
        aria-label={t("unblockName", { name })}
        onClick={(event) => onUnblock(event.currentTarget)}
      >
        {t("unblock")}
      </Button>
    </li>
  );
}
