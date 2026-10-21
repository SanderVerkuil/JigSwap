"use client";

// A circle thread's header (spec §6.2, §6.6): the circle avatar, the circle's
// name and a muted second line "Circle chat · 6 members" whose members part
// opens the members panel, the
// "Circle" quick link (md+), and one ⋯ menu: Mute/Unmute, Members, Change
// icon (Admins), Open circle, Leave circle, Report a member. The members panel is a 360px
// right-side sheet on desktop and a bottom sheet on phones; it lists the
// circle's members (getCircle: members only, projected by the circle rule),
// with Mute and Leave at the bottom. Leave uses the circles page's confirm.
// Presence: one batched getPresenceOf subscription for the circle's members
// feeds both the "· N online" count and the members' dots; the backend returns
// only members the viewer may see (mutual followers who both share).
import { Link } from "@/compat/link";
import { canManageCircle } from "@/components/circles/circle-admin-sections";
import { useCircleIconPicker } from "@/components/circles/circle-icon";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { MemberInitial } from "@/components/members/member-initial";
import { PresenceDot } from "@/components/presence/presence-dot";
import {
  usePresenceOf,
  type PresenceStatus,
} from "@/components/presence/use-presence";
import { ReportDialog } from "@/components/safety/report-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProjectedMemberName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  BellOff,
  Flag,
  ImagePlus,
  LogOut,
  MoreVertical,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { CircleThreadAvatar } from "./circle-thread-avatar";
import { circleHref, type CircleThread } from "./format";

type CircleDetail = NonNullable<ReturnType<typeof useCircleDetail>["data"]>;
type CircleMember = CircleDetail["members"][number];

function useCircleDetail(circleId: string) {
  return useQuery(convexQuery(gateway.sharing.circle, { circleId }));
}

// Mute or unmute this thread for the viewer only.
function useThreadMute(thread: CircleThread) {
  const t = useTranslations("messages");
  const setThreadMuted = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.setThreadMuted),
  });
  const muted = thread.muted === true;
  const toggle = () => {
    setThreadMuted
      .mutateAsync({ threadId: thread.threadId, muted: !muted })
      .catch(() => toast.error(t("circle.muteError")));
  };
  return { muted, toggle, pending: setThreadMuted.isPending };
}

export function CircleThreadHeader({
  thread,
  heading,
}: {
  thread: CircleThread;
  /** The thread title (the circle's name), owned by ThreadView for focus. */
  heading: ReactNode;
}) {
  const t = useTranslations("messages");
  const tCircles = useTranslations("circles");
  const tPresence = useTranslations("presence");
  const { subject } = thread;
  const { member: me } = useCurrentMember();
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const { muted, toggle, pending } = useThreadMute(thread);
  const { data: detail } = useCircleDetail(subject.circleId);
  // The owner can't leave their own circle (they delete it instead).
  const canLeave = detail ? !detail.isOwnedByViewer : false;
  // Admins only (the server checks it too): the same uploader as the manage dialog.
  const canChangeIcon = detail
    ? canManageCircle(detail.viewerPermission)
    : false;
  const iconPicker = useCircleIconPicker(subject.circleId);
  const presence = usePresenceOf(
    detail?.members
      .map((member) => member.memberId)
      .filter((memberId) => memberId !== me?._id) ?? [],
  );
  // "N online" counts Online only: an Away member isn't online.
  const onlineCount = [...presence.values()].filter(
    (status) => status === "online",
  ).length;
  const MuteIcon = muted ? Bell : BellOff;

  return (
    <>
      <CircleThreadAvatar
        members={subject.memberPreview}
        iconUrl={subject.iconUrl}
        className="size-9"
      />
      <div className="flex min-w-0 flex-col">
        {heading}
        {/* "Circle chat · 6 members · 2 online": the prefix names the chat a
            group (the heading says it for screen readers); only the members
            part opens the panel, and only it truncates. */}
        <div className="text-muted-foreground flex min-w-0 items-baseline text-xs leading-4">
          <span aria-hidden className="shrink-0">
            {t("circle.circleChat")}&nbsp;·&nbsp;
          </span>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setMembersOpen(true)}
            className="hover:text-foreground focus-visible:ring-ring relative min-w-0 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 max-md:before:absolute max-md:before:-inset-x-2 max-md:before:-inset-y-3"
          >
            {t("circle.memberCount", { count: subject.memberCount })}
            {onlineCount > 0 &&
              ` · ${tPresence("onlineCount", { count: onlineCount })}`}
          </button>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="hidden md:flex">
          <Link href={circleHref(subject.circleId)}>
            <Users aria-hidden />
            {t("circle.circleLink")}
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0 md:size-9"
              aria-label={t("threadActions")}
            >
              <MoreVertical className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="min-h-11 md:min-h-0"
              disabled={pending}
              onSelect={toggle}
            >
              <MuteIcon aria-hidden />
              {muted ? t("circle.unmute") : t("circle.mute")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 md:min-h-0"
              onSelect={() => setMembersOpen(true)}
            >
              <Users aria-hidden />
              {t("circle.members")}
            </DropdownMenuItem>
            {canChangeIcon && (
              <DropdownMenuItem
                className="min-h-11 md:min-h-0"
                disabled={iconPicker.uploading}
                onSelect={iconPicker.pick}
              >
                <ImagePlus aria-hidden />
                {tCircles("icon.change")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild className="min-h-11 md:min-h-0">
              <Link href={circleHref(subject.circleId)}>
                <Users aria-hidden />
                {t("circle.openCircle")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-h-11 md:min-h-0"
              onSelect={() => setMembersOpen(true)}
            >
              <Flag aria-hidden />
              {t("circle.reportMember")}
            </DropdownMenuItem>
            {canLeave && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  className="min-h-11 md:min-h-0"
                  onSelect={() => setLeaveOpen(true)}
                >
                  <LogOut aria-hidden />
                  {tCircles("leave")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CircleMembersSheet
        thread={thread}
        detail={detail}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        canLeave={canLeave}
        onLeave={() => setLeaveOpen(true)}
        presence={presence}
      />
      <LeaveCircleDialog
        circleId={subject.circleId}
        circleName={subject.name}
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
      />
      {iconPicker.dialogs}
    </>
  );
}

// The members panel. `detail` is undefined while loading and null when the
// circle is no longer readable (the viewer just left, or it was deleted).
export function CircleMembersSheet({
  thread,
  detail,
  open,
  onOpenChange,
  canLeave,
  onLeave,
  presence,
}: {
  thread: CircleThread;
  detail: CircleDetail | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canLeave: boolean;
  onLeave: () => void;
  /** Statuses of the members the viewer may see (absent = show no dot). */
  presence?: ReadonlyMap<string, PresenceStatus>;
}) {
  const t = useTranslations("messages");
  const tCircles = useTranslations("circles");
  const isMobile = useIsMobile();
  const { muted, toggle, pending } = useThreadMute(thread);
  const count = detail?.members.length ?? thread.subject.memberCount;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "gap-0 p-0",
          isMobile
            ? "max-h-[90dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)]"
            : "w-full sm:max-w-[360px]",
        )}
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>{t("circle.membersTitle", { count })}</SheetTitle>
          <SheetDescription>
            {t("circle.membersDescription", { circle: thread.subject.name })}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {detail === undefined ? (
            <div className="flex flex-col gap-1 p-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-12 items-center gap-3">
                  <Skeleton className="size-9 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </div>
          ) : detail === null ? (
            <p className="text-muted-foreground p-2 text-sm">
              {t("circle.membersError")}
            </p>
          ) : (
            <ul role="list" className="flex flex-col">
              {detail.members.map((member) => (
                <MemberRow
                  key={member.membershipId}
                  member={member}
                  presence={
                    member.memberId === undefined
                      ? undefined
                      : presence?.get(member.memberId)
                  }
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t p-4">
          <Button
            variant="outline"
            className="max-md:min-h-11"
            disabled={pending}
            onClick={toggle}
          >
            {muted ? <Bell aria-hidden /> : <BellOff aria-hidden />}
            {muted ? t("circle.unmute") : t("circle.mute")}
          </Button>
          {canLeave && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive max-md:min-h-11"
              onClick={onLeave}
            >
              <LogOut aria-hidden />
              {tCircles("leave")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// One member: avatar with their presence dot, name (a profile link unless the
// account is gone), role badge, and Report for others.
function MemberRow({
  member,
  presence,
}: {
  member: CircleMember;
  presence: PresenceStatus | undefined;
}) {
  const t = useTranslations("messages");
  const tCircles = useTranslations("circles");
  const tSafety = useTranslations("safety");
  const projectedName = useProjectedMemberName();
  const { member: me } = useCurrentMember();
  const [reporting, setReporting] = useState(false);
  // A departed seat carries no memberId: never "me", no profile link, no Report.
  const { memberId } = member;
  const isMe = memberId !== undefined && me?._id === memberId;
  const name = projectedName(
    member.departed
      ? { anonymous: true, departed: true }
      : { anonymous: false, member },
    "",
  );
  const role = member.isOwner
    ? tCircles("roleOwner")
    : member.permission === "Admin"
      ? tCircles("permissions.Admin")
      : null;
  const profileHref =
    member.departed || memberId === undefined
      ? null
      : `/members/${encodeURIComponent(member.username ?? memberId)}`;

  return (
    <li className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-1">
      {/* Relative so the presence dot pins to the avatar's corner. */}
      <span className="relative shrink-0">
        <Avatar aria-hidden className="size-9">
          {member.avatar && <AvatarImage src={member.avatar} alt="" />}
          <AvatarFallback>
            <MemberInitial source={member} />
          </AvatarFallback>
        </Avatar>
        <PresenceDot status={presence} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {profileHref && !isMe ? (
          <Link
            href={profileHref}
            className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2"
          >
            {name}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium">{name}</span>
        )}
        {isMe && (
          <span className="text-muted-foreground shrink-0 text-xs">
            ({t("you")})
          </span>
        )}
        {role && (
          <Badge variant="secondary" className="shrink-0">
            {role}
          </Badge>
        )}
      </div>
      {!isMe && !member.departed && memberId !== undefined && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-11 shrink-0 md:size-9"
            aria-label={tSafety("reportName", { name })}
            onClick={() => setReporting(true)}
          >
            <Flag aria-hidden className="size-4" />
          </Button>
          <ReportDialog
            target={{ kind: "user", id: memberId }}
            name={name}
            memberId={memberId as Id<"users">}
            open={reporting}
            onOpenChange={setReporting}
          />
        </>
      )}
    </li>
  );
}

// The circles page's leave confirm, controlled so the header menu and the
// members panel can open it. Leaving drops the thread, so land on the inbox.
function LeaveCircleDialog({
  circleId,
  circleName,
  open,
  onOpenChange,
}: {
  circleId: string;
  circleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tCircles = useTranslations("circles");
  const tCommon = useTranslations("common");
  const navigate = useNavigate();
  const leaveCircle = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.leaveCircle),
  });

  const handleLeave = async () => {
    try {
      await leaveCircle.mutateAsync({ circleId });
      await navigate({ to: "/messages" });
    } catch {
      toast.error(tCircles("leaveError"));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tCircles("leaveConfirmTitle", { circle: circleName })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tCircles("leaveConfirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={leaveCircle.isPending}
            onClick={() => void handleLeave()}
          >
            {tCircles("leave")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
