"use client";

// Attach-a-puzzle picker (message-center redesign spec §7): a dialog from md
// up, a bottom sheet on phones. Tabs for my copies / the other member's copies
// (the latter hidden when the backend would return none — anonymised member),
// a debounced search, and a list of copies; picking one hands it back and
// closes. Lists only what listAttachableCopies allows, i.e. copies both
// participants may view.
import { Image } from "@/compat/image";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TAB_TRIGGER_CLASS,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Puzzle, Search } from "lucide-react";
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
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  // The other member's tab label; null hides that tab.
  theirsLabel: string | null;
  onSelect: (copy: MessageCopy) => void;
}) {
  const t = useTranslations("messages");
  const isMobile = useIsMobile();
  const searchRef = useRef<HTMLInputElement>(null);

  const body = (
    <PickerBody
      threadId={threadId}
      theirsLabel={theirsLabel}
      searchRef={searchRef}
      onSelect={(copy) => {
        onSelect(copy);
        onOpenChange(false);
      }}
    />
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
          className="bg-card h-[85dvh] gap-0 rounded-t-[20px] border-t-0 p-0"
        >
          <SheetTitle className="font-heading px-4 pt-4 pb-2 text-lg font-bold">
            {t("attachTitle")}
          </SheetTitle>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        className="flex h-[min(36rem,85vh)] max-w-md flex-col gap-0 p-0"
      >
        <DialogTitle className="font-heading px-5 pt-5 pb-2 text-lg font-bold">
          {t("attachTitle")}
        </DialogTitle>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  threadId,
  theirsLabel,
  searchRef,
  onSelect,
}: {
  threadId: string;
  theirsLabel: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (copy: MessageCopy) => void;
}) {
  const t = useTranslations("messages");
  const [side, setSide] = useState<Side>("mine");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs
        value={side}
        onValueChange={(value) => setSide(value as Side)}
        className="gap-0 px-2"
      >
        <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
          <TabsTrigger value="mine" className={TAB_TRIGGER_CLASS}>
            {t("tabMine")}
          </TabsTrigger>
          {theirsLabel !== null && (
            <TabsTrigger
              value="theirs"
              // A long member name truncates instead of widening the sheet.
              className={cn(TAB_TRIGGER_CLASS, "min-w-0 shrink")}
            >
              <span className="truncate">{theirsLabel}</span>
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPuzzles")}
            aria-label={t("searchPuzzles")}
            className="h-11 pl-9 md:h-10"
          />
        </div>
      </div>
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
          <p className="text-muted-foreground px-4 py-10 text-center text-sm">
            {search ? t("noPuzzleResults", { query: search }) : t("noPuzzles")}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {copies.map((copy) => (
              <li key={copy.copyId}>
                <CopyOption copy={copy} onSelect={() => onSelect(copy)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CopyOption({
  copy,
  onSelect,
}: {
  copy: MessageCopy;
  onSelect: () => void;
}) {
  const t = useTranslations("copyConversation");
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
      </span>
    </button>
  );
}
