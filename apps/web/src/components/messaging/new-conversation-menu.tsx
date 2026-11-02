"use client";

// The inbox's "New" (spec §6.4): Message a member, which picks someone the
// viewer can already message and opens their DM (UX-114), or Circle chat,
// which picks one of the viewer's circles and opens its group chat. A
// dropdown plus a picker dialog on desktop; one bottom sheet on phones that
// steps from the choice to the picker.
import { Link } from "@/compat/link";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { Search, SquarePen, UserRound, Users, UserSearch } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "use-intl";
import { CircleThreadAvatar } from "./circle-thread-avatar";
import { dmCandidates, type DmCandidate } from "./dm-candidates";
import { matchesSearch } from "./format";
import { useOpenCircleChat } from "./open-circle-chat";
import { useOpenDm } from "./open-dm";

const OPTION_CLASS =
  "hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-60";

type Picker = "member" | "circle";

export function NewConversationMenu() {
  const t = useTranslations("messages");
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  // The open picker: a dialog on desktop, the sheet's second step on phones.
  const [picker, setPicker] = useState<Picker | null>(null);
  const pickerTitle: Record<Picker, string> = {
    member: t("circle.messageMember"),
    circle: t("circle.pickCircleTitle"),
  };
  const pickerDescription: Record<Picker, string> = {
    member: t("memberPicker.description"),
    circle: t("circle.pickCircleDescription"),
  };

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
            if (!open) setPicker(null);
          }}
        >
          <SheetContent
            side="bottom"
            className="max-h-[90dvh] gap-3 overflow-y-auto rounded-t-xl p-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetTitle className="text-base font-semibold">
              {picker ? pickerTitle[picker] : t("circle.newConversationLabel")}
            </SheetTitle>
            <SheetDescription className={picker ? undefined : "sr-only"}>
              {picker
                ? pickerDescription[picker]
                : t("circle.newConversationLabel")}
            </SheetDescription>
            {picker === "member" ? (
              // No autofocus: the keyboard would cover the list.
              <MemberPicker
                autoFocusSearch={false}
                onOpened={() => {
                  setMenuOpen(false);
                  setPicker(null);
                }}
              />
            ) : picker === "circle" ? (
              <CirclePicker
                onOpened={() => {
                  setMenuOpen(false);
                  setPicker(null);
                }}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className={OPTION_CLASS}
                  onClick={() => setPicker("member")}
                >
                  <UserRound aria-hidden className="text-primary-text size-5" />
                  {t("circle.messageMember")}
                </button>
                <button
                  type="button"
                  className={OPTION_CLASS}
                  onClick={() => setPicker("circle")}
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
          <DropdownMenuItem onSelect={() => setPicker("member")}>
            <UserRound aria-hidden />
            {t("circle.messageMember")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicker("circle")}>
            <Users aria-hidden />
            {t("circle.circleChat")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* One dialog per picker, so each keeps its content while closing. */}
      {(["member", "circle"] as const).map((kind) => (
        <Dialog
          key={kind}
          open={picker === kind}
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
        >
          <DialogContent className="max-h-[80dvh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{pickerTitle[kind]}</DialogTitle>
              <DialogDescription>{pickerDescription[kind]}</DialogDescription>
            </DialogHeader>
            {kind === "member" ? (
              <MemberPicker autoFocusSearch onOpened={() => setPicker(null)} />
            ) : (
              <CirclePicker onOpened={() => setPicker(null)} />
            )}
          </DialogContent>
        </Dialog>
      ))}
    </>
  );
}

// The ConnectionPolicy's "people you can message" the client already knows
// (dmCandidates): Recent DM and exchange partners, then mutual followers, with
// a name search. Picking one opens the DM, then onOpened closes the dialog or
// sheet (it stays open on error, beside the toast). Anyone else (a circle
// member, someone new) is one step away on People's Find tab.
function MemberPicker({
  autoFocusSearch,
  onOpened,
}: {
  autoFocusSearch: boolean;
  onOpened: () => void;
}) {
  const t = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const { open, pending } = useOpenDm();
  const [query, setQuery] = useState("");
  const recentId = useId();
  const mutualId = useId();
  const inbox = useQuery(convexQuery(gateway.conversation.getMyInbox, {}));
  const following = useQuery(convexQuery(gateway.social.following, {}));

  // A list that fails to load counts as empty, so the others still show.
  const inboxRows = inbox.isError ? [] : inbox.data;
  const followingRows = following.isError ? [] : following.data;
  if (inboxRows === undefined || followingRows === undefined) {
    return (
      <div className="flex flex-col gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const { recent, mutual } = dmCandidates(inboxRows, followingRows);
  if (recent.length === 0 && mutual.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-muted-foreground text-sm">
          {t("memberPicker.empty")}
        </p>
        <Button asChild variant="outline" size="sm" className="max-md:min-h-11">
          <RouterLink to="/people" search={{ tab: "find" }}>
            {t("memberPicker.findMembers")}
          </RouterLink>
        </Button>
      </div>
    );
  }

  const matching = (members: DmCandidate[]) =>
    members.filter((member) => matchesSearch(displayName(member.name), query));
  const sections = [
    {
      id: recentId,
      label: t("memberPicker.recent"),
      members: matching(recent),
    },
    {
      id: mutualId,
      label: t("memberPicker.mutual"),
      members: matching(mutual),
    },
  ].filter((section) => section.members.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus={autoFocusSearch}
          placeholder={t("memberPicker.searchPlaceholder")}
          aria-label={t("memberPicker.searchLabel")}
          className="h-11 pl-9 md:h-9"
        />
      </div>
      {sections.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-sm">
          {t("memberPicker.noMatch", { query: query.trim() })}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="flex flex-col gap-1">
            <h3
              id={section.id}
              className="text-muted-foreground px-3 text-xs font-medium"
            >
              {section.label}
            </h3>
            <ul
              role="list"
              aria-labelledby={section.id}
              className="flex flex-col gap-1"
            >
              {section.members.map((member) => (
                <li key={member.memberId}>
                  <button
                    type="button"
                    className={OPTION_CLASS}
                    disabled={pending}
                    onClick={async () => {
                      if (await open(member.memberId)) onOpened();
                    }}
                  >
                    {/* Decorative: the name sits right next to it. */}
                    <Avatar aria-hidden className="size-9 shrink-0">
                      {member.avatar && (
                        <AvatarImage src={member.avatar} alt="" />
                      )}
                      <AvatarFallback>
                        <MemberInitial source={member.name} />
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">
                      {displayName(member.name)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <div className="border-t pt-2">
        <RouterLink
          to="/people"
          search={{ tab: "find" }}
          className={OPTION_CLASS}
        >
          <UserSearch aria-hidden className="text-primary-text size-5" />
          {t("memberPicker.findSomeoneElse")}
        </RouterLink>
      </div>
    </div>
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
