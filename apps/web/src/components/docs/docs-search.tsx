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
import { pagesForLocale } from "@/docs/nav";
import { buildSearchDocs, createDocsIndex } from "@/docs/search";
import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";

// Docs command palette. We disable cmdk's own filtering (`shouldFilter={false}`)
// and feed it MiniSearch results for our controlled query, so ranking/snippets
// come from MiniSearch rather than cmdk's substring match.
export function DocsSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useTranslations("marketing.docs");
  const locale = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  // Rebuilt per locale (en + locale overrides); the corpus is otherwise static.
  const index = React.useMemo(
    () => createDocsIndex(buildSearchDocs(pagesForLocale(pages, locale))),
    [locale],
  );
  const hits = React.useMemo(() => index.search(query), [index, query]);

  const go = (slug: string) => {
    onOpenChange(false);
    setQuery("");
    navigate({ to: "/docs/$", params: { _splat: slug } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("searchTitle")}</DialogTitle>
          <DialogDescription>{t("searchDescription")}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          <CommandInput
            placeholder={t("searchPlaceholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {query.trim() !== "" && hits.length === 0 && (
              <CommandEmpty>{t("searchEmpty")}</CommandEmpty>
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
