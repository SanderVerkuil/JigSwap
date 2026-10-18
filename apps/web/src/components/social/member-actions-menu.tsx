"use client";

// Overflow menu of actions on another member, shared by the thread header and
// the member profile. `children` are the host's own items (e.g. thread quick
// links); the safety items follow after a separator. The trigger is a 44px
// target below md and is named by `label`; destructive items carry text, not
// colour alone. Focus returns to the trigger when the confirm dialog closes.
import { BlockMemberDialog } from "@/components/social/block-member-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/gateway";
import { cn } from "@/lib/utils";
import { Ban, type LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "use-intl";

export function MemberActionsMenu({
  memberId,
  name,
  label,
  icon: Icon,
  onBlocked,
  className,
  children,
}: {
  memberId: Id<"users">;
  /** The member's resolved display name. */
  name: string;
  /** The trigger's accessible name. */
  label: string;
  icon: LucideIcon;
  onBlocked?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("safety");
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className={cn("size-11 shrink-0 md:size-9", className)}
            aria-label={label}
          >
            <Icon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {children}
          {children && <DropdownMenuSeparator />}
          {/* "Report {name}" (milestone A6) goes here, after Block. */}
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11 md:min-h-0"
            onSelect={() => setConfirming(true)}
          >
            <Ban aria-hidden />
            {t("blockName", { name })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BlockMemberDialog
        mode="block"
        memberId={memberId}
        name={name}
        open={confirming}
        onOpenChange={setConfirming}
        onDone={onBlocked}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
