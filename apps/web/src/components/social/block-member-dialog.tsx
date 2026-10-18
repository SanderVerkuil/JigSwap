"use client";

// Confirm dialog for blocking or unblocking a member (spec 2.6). Controlled, so
// any trigger can open it: a DropdownMenuItem (thread header, profile), the
// blocked-thread banner, or a row of the "Blocked members" settings list.
// Cancel takes initial focus (Radix AlertDialog's default). Because a menu item
// that opened the dialog is gone by the time it closes, `returnFocusRef` names
// the element focus goes back to (the menu trigger).
//
// Blocking toasts "Blocked {name}" with an Undo that unblocks straight away.
// The server is the real gate (requireMember, rate limit); the UI only maps its
// refusals to copy: RateLimited gets "Try again later", the rest a generic error.
import { conversationErrorCode } from "@/components/messaging/format";
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
import { buttonVariants } from "@/components/ui/button";
import { gateway, type Id } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

export type BlockDialogMode = "block" | "unblock";

export function BlockMemberDialog({
  mode,
  memberId,
  name,
  open,
  onOpenChange,
  onDone,
  returnFocusRef,
}: {
  mode: BlockDialogMode;
  memberId: Id<"users">;
  /** The member's resolved display name (useMemberDisplayName). */
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the block/unblock mutation succeeded. */
  onDone?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations("safety");
  const tCommon = useTranslations("common");
  // The raw Convex mutation functions (not a react-query observer): the toast's
  // Undo can fire after this dialog's host has re-rendered without it.
  const block = useConvexMutation(gateway.social.blockMember);
  const unblock = useConvexMutation(gateway.social.unblockMember);

  const errorToast = (error: unknown, fallback: string) =>
    toast.error(
      conversationErrorCode(error) === "RateLimited"
        ? t("rateLimited")
        : fallback,
    );

  const undoBlock = async () => {
    try {
      await unblock({ memberId });
      toast.success(t("unblocked", { name }));
    } catch (error) {
      errorToast(error, t("unblockError", { name }));
    }
  };

  const confirm = async () => {
    try {
      if (mode === "block") {
        await block({ memberId });
        toast.success(t("blocked", { name }), {
          action: { label: t("undo"), onClick: () => void undoBlock() },
        });
      } else {
        await unblock({ memberId });
        toast.success(t("unblocked", { name }));
      }
      onDone?.();
    } catch (error) {
      errorToast(
        error,
        mode === "block"
          ? t("blockError", { name })
          : t("unblockError", { name }),
      );
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // A trigger that unmounted meanwhile (e.g. the unblocked list row)
          // can't take focus: leave it to Radix.
          const target = returnFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "block"
              ? t("blockConfirmTitle", { name })
              : t("unblockConfirmTitle", { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === "block"
              ? t("blockConfirmBody", { name })
              : t("unblockConfirmBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 md:h-9">
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({
              variant: mode === "block" ? "destructive" : "default",
              className: "h-11 md:h-9",
            })}
            onClick={() => void confirm()}
          >
            {mode === "block" ? t("blockAction") : t("unblock")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
