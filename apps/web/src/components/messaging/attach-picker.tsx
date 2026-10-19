"use client";

// Attach-a-puzzle picker (message-center redesign spec §7): a dialog from md
// up, a bottom sheet on phones. Tabs for my copies / the other member's copies
// (the latter hidden when the backend would return none — anonymised member),
// a debounced search, and a list of copies; picking one hands it back and
// closes. Lists only what listAttachableCopies allows, i.e. copies both
// participants may view (in a circle: my copies at least one other member may
// view, explained by `hint`; one only some members may view says so).
import { Image } from "@/compat/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TAB_TRIGGER_CLASS,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Puzzle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import type { MessageCopy } from "./copy-card";

type Side = "mine" | "theirs";

const SEARCH_DEBOUNCE_MS = 250;

export function AttachPicker({
  open,
  onOpenChange,
  threadId,
  theirsLabel,
  hint,
  onSelect,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  // The other member's tab label; null hides that tab.
  theirsLabel: string | null;
  // A note above the list (a circle thread: who can see the puzzles).
  hint?: string;
  onSelect: (copy: MessageCopy) => void;
  // Where focus lands on close (the composer decides: textarea after a pick,
  // else the attach button) — without it Radix drops focus on <body>.
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations("messages");
  const tCommon = useTranslations("common");
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);

  const body = (
    <PickerBody
      threadId={threadId}
      theirsLabel={theirsLabel}
      hint={hint}
      searchRef={searchRef}
      onSelect={(copy) => {
        onSelect(copy);
        onOpenChange(false);
      }}
    />
  );
  // Our own 44px close button, first in the tab order (before the tabs), in
  // place of the primitives' 16px corner X.
  const closeButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 shrink-0"
      aria-label={tCommon("close")}
    >
      <X className="size-5" />
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          // Never pop the keyboard unasked on phones: focus the sheet itself
          // (inside the dialog for screen readers) instead of the search box.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={onCloseAutoFocus}
          // [&>button]:hidden drops the primitive's own close (display:none,
          // so it's out of the tab order too) — ours sits in the title row.
          className="bg-card h-[85dvh] gap-0 rounded-t-[20px] border-t-0 p-0 motion-reduce:animate-none [&>button]:hidden"
        >
          <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-4">
            <SheetTitle className="font-heading min-w-0 flex-1 text-lg font-bold">
              {t("attachTitle")}
            </SheetTitle>
            <SheetClose asChild>{closeButton}</SheetClose>
          </div>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        className="flex h-[min(36rem,85vh)] max-w-md flex-col gap-0 p-0 motion-reduce:animate-none"
      >
        <div className="flex items-center gap-2 py-2 pr-2 pl-5">
          <DialogTitle className="font-heading min-w-0 flex-1 text-lg font-bold">
            {t("attachTitle")}
          </DialogTitle>
          <DialogClose asChild>{closeButton}</DialogClose>
        </div>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  threadId,
  theirsLabel,
  hint,
  searchRef,
  onSelect,
}: {
  threadId: string;
  theirsLabel: string | null;
  hint?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (copy: MessageCopy) => void;
}) {
  const t = useTranslations("messages");
  const [side, setSide] = useState<Side>("mine");
  // One search box value shared by both tabs.
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const tabTrigger = cn(TAB_TRIGGER_CLASS, "min-h-11 md:min-h-0");
  const panel = (
    <PickerPanel
      threadId={threadId}
      side={side}
      query={query}
      search={search}
      onQueryChange={setQuery}
      hint={hint}
      searchRef={searchRef}
      onSelect={onSelect}
    />
  );

  return (
    <Tabs
      value={side}
      onValueChange={(value) => setSide(value as Side)}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList className={cn(UNDERLINE_TABS_LIST_CLASS, "px-2")}>
        <TabsTrigger value="mine" className={tabTrigger}>
          {t("tabMine")}
        </TabsTrigger>
        {theirsLabel !== null && (
          <TabsTrigger
            value="theirs"
            // A long member name truncates instead of widening the sheet.
            className={cn(tabTrigger, "min-w-0 shrink")}
          >
            <span className="truncate">{theirsLabel}</span>
          </TabsTrigger>
        )}
      </TabsList>
      {/* Real tabpanels, so each trigger's aria-controls resolves. */}
      <TabsContent value="mine" className="flex min-h-0 flex-col">
        {side === "mine" && panel}
      </TabsContent>
      {theirsLabel !== null && (
        <TabsContent value="theirs" className="flex min-h-0 flex-col">
          {side === "theirs" && panel}
        </TabsContent>
      )}
    </Tabs>
  );
}

function PickerPanel({
  threadId,
  side,
  query,
  search,
  onQueryChange,
  hint,
  searchRef,
  onSelect,
}: {
  threadId: string;
  side: Side;
  query: string;
  search: string;
  onQueryChange: (query: string) => void;
  hint?: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (copy: MessageCopy) => void;
}) {
  const t = useTranslations("messages");
  const { data: copies } = useQuery({
    ...convexQuery(gateway.conversation.listAttachableCopies, {
      threadId,
      side,
      ...(search ? { search } : {}),
    }),
    // Keep the previous results on screen while the next search resolves.
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("searchPuzzles")}
            aria-label={t("searchPuzzles")}
            className="h-11 pl-9 md:h-10"
          />
        </div>
        {hint && <p className="text-muted-foreground mt-2 text-xs">{hint}</p>}
      </div>
      {/* Result count for screen readers, updated as the search settles. */}
      <p role="status" className="sr-only">
        {copies && copies.length > 0
          ? t("puzzleCount", { count: copies.length })
          : ""}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {copies === undefined ? (
          <div className="flex flex-col gap-1 px-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-16 items-center gap-3 px-3">
                <Skeleton className="size-12 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : copies.length === 0 ? (
          <p
            role="status"
            className="text-muted-foreground px-4 py-10 text-center text-sm"
          >
            {search ? t("noPuzzleResults", { query: search }) : t("noPuzzles")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {copies.map((copy) => (
              <li key={copy.copyId}>
                <CopyOption
                  copy={copy}
                  limitedAudience={copy.limitedAudience === true}
                  onSelect={() => onSelect(copy)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function CopyOption({
  copy,
  limitedAudience,
  onSelect,
}: {
  copy: MessageCopy;
  // Circle thread: only some of the circle's members may see this puzzle.
  limitedAudience: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("copyConversation");
  const tMessages = useTranslations("messages");
  const meta = [
    copy.brand,
    copy.pieceCount !== null ? t("pieces", { count: copy.pieceCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      className="hover:bg-muted/60 focus-visible:ring-ring flex h-16 w-full items-center gap-3 rounded-lg px-3 text-left outline-none transition-colors focus-visible:ring-2"
    >
      <span className="bg-muted relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {copy.coverUrl ? (
          <Image src={copy.coverUrl} alt="" fill className="object-cover" />
        ) : (
          <Puzzle className="text-muted-foreground size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {copy.title}
        </span>
        {meta && (
          <span className="text-muted-foreground block truncate text-xs">
            {meta}
          </span>
        )}
        {limitedAudience && (
          <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <EyeOff aria-hidden className="size-3 shrink-0" />
            {tMessages("circle.limitedAudience")}
          </span>
        )}
      </span>
    </button>
  );
}
