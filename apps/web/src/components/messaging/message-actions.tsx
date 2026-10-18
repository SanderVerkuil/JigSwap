"use client";

// Per-message actions on the OTHER member's messages (spec 2.5): a "More"
// button beside the bubble with Copy text and Report message. On desktop it
// shows on hover / focus-within; below md it is always visible (a 44px
// target), so long-press (which opens the same menu) is never the only path
// (WCAG 2.5.1). The caller renders this only for others' non-system,
// non-removed messages. On a photo message, Report targets the photo
// (targetKind attachment) and Copy text appears only when it has a caption.
import { ReportDialog } from "@/components/safety/report-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Id } from "@/gateway";
import { Copy, Flag, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const LONG_PRESS_MS = 500;

export function MessageActions({
  messageId,
  body,
  authorName,
  authorId,
  attachmentId,
  children,
}: {
  messageId: string;
  body: string;
  /** The author's display name (or a generic fallback). */
  authorName: string;
  /** The author's member id, when the viewer may know who they are. */
  authorId?: Id<"users">;
  /** A photo message's attachment: the report is about the photo. */
  attachmentId?: string;
  /** The message bubble. */
  children: ReactNode;
}) {
  const t = useTranslations("safety");
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const cancelPress = () => clearTimeout(pressTimer.current);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(body);
      toast.success(t("textCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div
      className="group flex max-w-full items-start gap-1"
      // Long-press (touch only) opens the same menu as the button.
      onPointerDown={(event) => {
        if (event.pointerType !== "touch") return;
        cancelPress();
        pressTimer.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
      }}
      onPointerUp={cancelPress}
      onPointerMove={cancelPress}
      onPointerCancel={cancelPress}
    >
      {children}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={t("messageActions", { name: authorName })}
            className="size-11 shrink-0 md:size-8 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {body.trim() && (
            <DropdownMenuItem
              className="min-h-11 md:min-h-0"
              onSelect={() => void copyText()}
            >
              <Copy aria-hidden />
              {t("copyText")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11 md:min-h-0"
            onSelect={() => setReporting(true)}
          >
            <Flag aria-hidden />
            {attachmentId ? t("reportPhoto") : t("reportMessage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog
        target={
          attachmentId
            ? { kind: "attachment", id: attachmentId }
            : { kind: "message", id: messageId, snippet: body }
        }
        name={authorName}
        memberId={authorId}
        open={reporting}
        onOpenChange={setReporting}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}
