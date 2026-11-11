import { focusHashTarget } from "@/components/a11y/skip-link";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createDocsSearchStore } from "@/docs/search-store";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";
import { searchLoaders } from "virtual:docs/search";

// Each locale's corpus is its own chunk (en fills untranslated pages); a
// locale without docs searches the English ones, as the nav shows them.
const searchStore = createDocsSearchStore(async (locale) => {
  const load = searchLoaders[locale] ?? searchLoaders.en;
  return load ? (await load()).docs : [];
});

// Opens the FAQ question or heading `hash` names, brings it into view and moves focus to it, as a
// pick on another page would; with no section, back to the top of the page.
function landOn(hash: string) {
  const target = hash ? document.getElementById(hash) : null;
  if (!target) {
    window.scrollTo({ top: 0 });
    return;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView();
  focusHashTarget(hash, { preventScroll: true });
}

// Docs command palette. We disable cmdk's own filtering (`shouldFilter={false}`)
// and feed it MiniSearch results for our controlled query, so ranking/snippets
// come from MiniSearch rather than cmdk's substring match.
export function DocsSearch({
  open,
  onOpenChange,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
} & Pick<
  React.ComponentProps<typeof DialogContent>,
  "onOpenAutoFocus" | "onCloseAutoFocus"
>) {
  const t = useTranslations("marketing.docs");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  // The search corpus and MiniSearch load on the first open, not with the page.
  React.useEffect(() => {
    if (open) void searchStore.load(locale);
  }, [open, locale]);
  const index = React.useSyncExternalStore(
    searchStore.subscribe,
    () => searchStore.get(locale),
    () => undefined,
  );
  // A failed load says so instead of "Loading…" forever; typing retries it.
  const failed = React.useSyncExternalStore(
    searchStore.subscribe,
    () => searchStore.failed(locale),
    () => false,
  );
  const onQueryChange = (value: string) => {
    setQuery(value);
    if (searchStore.failed(locale)) void searchStore.load(locale);
  };
  const hits = React.useMemo(() => index?.search(query) ?? [], [index, query]);
  // New results start at the top. cmdk selects the first one but doesn't reliably scroll to it,
  // which left the top result cut off under the search box. Its own scroll to the selection runs a
  // few renders after this effect (and can still aim at the last query's pick), so this waits a
  // frame to land after it.
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: 0 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hits]);

  // A result opens at its section when it has one (the page shows that FAQ question open). The
  // router leaves a page where it is scrolled to when it is at that place already, so picking the
  // section the page is at (again) lands there once the dialog has closed.
  const location = useLocation();
  const landingRef = React.useRef<string | null>(null);
  const go = (slug: string, hash?: string) => {
    onOpenChange(false);
    setQuery("");
    if (
      location.pathname.replace(/\/$/, "") === `/docs/${slug}` &&
      location.hash === (hash ?? "")
    ) {
      landingRef.current = location.hash;
      return;
    }
    void navigate({ to: "/docs/$", params: { _splat: slug }, hash });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (landingRef.current === null) return;
          event.preventDefault();
          landOn(landingRef.current);
          landingRef.current = null;
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("searchTitle")}</DialogTitle>
          <DialogDescription>{t("searchDescription")}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          {/* 16px on phones so iOS doesn't zoom the page when the input takes
              focus; the shared CommandInput stays text-sm elsewhere. */}
          <CommandInput
            className="text-base md:not-pointer-coarse:text-sm"
            placeholder={t("searchPlaceholder")}
            value={query}
            onValueChange={onQueryChange}
          />
          <CommandList ref={listRef}>
            {query.trim() !== "" && hits.length === 0 && (
              <CommandEmpty>
                {index
                  ? t("searchEmpty")
                  : failed
                    ? t("searchFailed")
                    : tCommon("loading")}
              </CommandEmpty>
            )}
            {hits.length > 0 && (
              <CommandGroup heading={t("searchPagesHeading")}>
                {hits.map((h) => (
                  <CommandItem
                    key={h.slug}
                    value={h.slug}
                    onSelect={() => go(h.slug, h.hash)}
                  >
                    <FileText className="size-4 text-mk-text-muted" />
                    <div className="flex min-w-0 flex-col">
                      {/* One line, so three results fit the list: a long page name and section
                          ("Veelgestelde vragen en problemen oplossen › Hoe rond ik…") each give
                          way in step with their length. The spaces keep the words apart in the
                          text; the flex row doesn't render them. */}
                      <span className="flex gap-1 text-[14px]">
                        <span className="truncate">{h.title}</span>
                        {h.section && (
                          <>
                            {" "}
                            <span aria-hidden="true">›</span>{" "}
                            <span className="truncate">{h.section}</span>
                          </>
                        )}
                      </span>
                      <span className="text-[12px] text-mk-text-muted">
                        {h.snippet}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
