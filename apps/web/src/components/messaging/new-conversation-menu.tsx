"use client";

// The inbox's "New" (spec §6.4): Message a member (the people page, where
// each member has a Message button) or Circle chat, which picks one of the
// viewer's circles and opens its group chat. A dropdown plus a picker dialog
// on desktop; one bottom sheet on phones that steps from the choice to the
// picker.
import { Link } from "@/compat/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, UserRound, Users } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { CircleThreadAvatar } from "./circle-thread-avatar";
import { useOpenCircleChat } from "./open-circle-chat";

const OPTION_CLASS =
  "hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-60";

export function NewConversationMenu() {
  const t = useTranslations("messages");
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const trigger = (
    <Button
      variant="ghost"
      size="sm"
      className="max-md:min-h-11"
      aria-label={t("circle.newConversationLabel")}
      aria-haspopup={isMobile ? "dialog" : "menu"}
      onClick={isMobile ? () => setMenuOpen(true) : undefined}
    >
      <SquarePen aria-hidden className="size-4" />
      {t("circle.newConversation")}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Sheet
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) setPickerOpen(false);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[90dvh] gap-3 overflow-y-auto rounded-t-xl p-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetTitle className="text-base font-semibold">
              {pickerOpen
                ? t("circle.pickCircleTitle")
                : t("circle.newConversationLabel")}
            </SheetTitle>
            <SheetDescription className={pickerOpen ? undefined : "sr-only"}>
              {pickerOpen
                ? t("circle.pickCircleDescription")
                : t("circle.newConversationLabel")}
            </SheetDescription>
            {pickerOpen ? (
              <CirclePicker
                onOpened={() => {
                  setMenuOpen(false);
                  setPickerOpen(false);
                }}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <Link href="/people" className={OPTION_CLASS}>
                  <UserRound aria-hidden className="text-primary-text size-5" />
                  {t("circle.messageMember")}
                </Link>
                <button
                  type="button"
                  className={OPTION_CLASS}
                  onClick={() => setPickerOpen(true)}
                >
                  <Users aria-hidden className="text-primary-text size-5" />
                  {t("circle.circleChat")}
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href="/people">
              <UserRound aria-hidden />
              {t("circle.messageMember")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
            <Users aria-hidden />
            {t("circle.circleChat")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("circle.pickCircleTitle")}</DialogTitle>
            <DialogDescription>
              {t("circle.pickCircleDescription")}
            </DialogDescription>
          </DialogHeader>
          <CirclePicker onOpened={() => setPickerOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// The viewer's circles; picking one opens its group chat, then onOpened closes
// the dialog or sheet (it stays open on error, beside the toast).
function CirclePicker({ onOpened }: { onOpened: () => void }) {
  const t = useTranslations("messages");
  const { open, pending } = useOpenCircleChat();
  const { data: circles } = useQuery(
    convexQuery(gateway.sharing.myCircles, {}),
  );

  if (circles === undefined) {
    return (
      <div className="flex flex-col gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const openable = circles.filter((circle) => circle.aggregateId);
  if (openable.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-muted-foreground text-sm">{t("circle.noCircles")}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/circles">{t("circle.goToCircles")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {openable.map((circle) => (
        <li key={circle._id}>
          <button
            type="button"
            className={OPTION_CLASS}
            disabled={pending}
            onClick={async () => {
              if (await open(circle.aggregateId!)) onOpened();
            }}
          >
            <CircleThreadAvatar
              members={[]}
              iconUrl={circle.iconUrl}
              className="ring-background size-9 ring-2"
            />
            <span className="min-w-0 flex-1 truncate">{circle.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs font-normal tabular-nums">
              {t("circle.memberCount", { count: circle.memberCount })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
