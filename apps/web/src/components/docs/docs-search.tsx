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
import { useNavigate } from "@tanstack/react-router";
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

  const go = (slug: string) => {
    onOpenChange(false);
    setQuery("");
    void navigate({ to: "/docs/$", params: { _splat: slug } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
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
          <CommandList>
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
                    onSelect={() => go(h.slug)}
                  >
                    <FileText className="size-4 text-mk-text-muted" />
                    <div className="flex flex-col">
                      <span className="text-[14px]">{h.title}</span>
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
