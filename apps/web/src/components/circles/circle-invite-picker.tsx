// "Invite" in the manage-circle dialog: search the people this Admin may invite
// (listInvitableMembers: the backend's contact rule, never a global search), choose the seat's
// permission, and send the invite. A member joins only once they accept.
import { circleInviteErrorKey } from "@/components/circles/circle-invite-error";
import { PersonRow } from "@/components/household/person-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway, Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";
const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

export type InvitableMember = FunctionReturnType<
  typeof gateway.sharing.invitableMembers
>[number];

export function CircleInvitePicker({ circleId }: { circleId: string }) {
  const t = useTranslations("circles");
  const [search, setSearch] = useState("");
  const [permission, setPermission] =
    useState<CirclePermissionLevel>("ViewOnly");

  const term = search.trim();
  const { data: candidates } = useQuery({
    ...convexQuery(
      gateway.sharing.invitableMembers,
      term ? { circleId, search: term } : { circleId },
    ),
    // Keep the last list while a new search term loads, so the empty state doesn't flash.
    placeholderData: keepPreviousData,
  });

  const invite = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.inviteToCircle),
    onSuccess: () => {
      setSearch("");
      toast.success(t("invite.sent"));
    },
    onError: (error) => toast.error(t(circleInviteErrorKey(error))),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("invite.searchPlaceholder")}
          aria-label={t("invite.searchPlaceholder")}
        />
        <Select
          value={permission}
          onValueChange={(value: CirclePermissionLevel) => setPermission(value)}
        >
          <SelectTrigger
            className="w-full sm:w-32"
            aria-label={t("invite.permissionLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {candidates !== undefined && (
        <InvitableMemberList
          candidates={candidates}
          busy={invite.isPending}
          onInvite={(member) =>
            invite.mutate({
              circleId,
              inviteeId: member.member._id as Id<"users">,
              permission,
            })
          }
        />
      )}
    </div>
  );
}

export function InvitableMemberList({
  candidates,
  busy = false,
  onInvite,
}: {
  candidates: InvitableMember[];
  busy?: boolean;
  onInvite: (member: InvitableMember) => void;
}) {
  const t = useTranslations("circles");
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm">
        {t("invite.empty")}
      </p>
    );
  }
  return (
    <div className="max-h-64 divide-y overflow-y-auto rounded-lg border px-4">
      {candidates.map((candidate) => (
        <PersonRow
          key={candidate.member._id}
          person={{
            memberId: candidate.member._id as string,
            name: candidate.member.name ?? candidate.member.username,
            avatar: candidate.member.avatar,
          }}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onInvite(candidate)}
          >
            <Send className="h-4 w-4" />
            {/* Icon-only on phones so the name keeps its room; still the button's accessible name. */}
            <span className="sr-only sm:not-sr-only">{t("invite.send")}</span>
          </Button>
        </PersonRow>
      ))}
    </div>
  );
}
