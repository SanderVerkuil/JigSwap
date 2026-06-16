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
import { buildSearchDocs, createDocsIndex } from "@/docs/search";
import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import * as React from "react";
import { pages } from "virtual:docs";

// Built once from the static manifest — the corpus is fixed at build time.
const index = createDocsIndex(buildSearchDocs(pages));

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
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const hits = React.useMemo(() => index.search(query), [query]);

  const go = (slug: string) => {
    onOpenChange(false);
    setQuery("");
    navigate({ to: "/docs/$", params: { _splat: slug } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Search documentation</DialogTitle>
          <DialogDescription>
            Find a page in the JigSwap user guide
          </DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          <CommandInput
            placeholder="Search the docs…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {query.trim() !== "" && hits.length === 0 && (
              <CommandEmpty>No results. Try a different term.</CommandEmpty>
            )}
            {hits.length > 0 && (
              <CommandGroup heading="Pages">
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
