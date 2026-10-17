import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway, type Id } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery } from "convex/react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { CataloguePickerView } from "./catalogue-picker-view";
import {
  buildPickerRows,
  pickerSearchQuery,
  pickerSearchResults,
  removeLastPick,
  removePick,
  setPickForTrade,
  toAcquireItems,
  togglePick,
  type Pick,
} from "./selection";

// How many search results the picker loads (the first page of the paginated search).
const SEARCH_LIMIT = 20;

// The catalogue search: the member-gated paginated `catalog.search` for text, or the barcode
// lookup for a 12/13-digit code, as in the add flow. The picker shows the first page only.
function useCatalogueSearch(term: string) {
  const { searchTerm, barcode } = pickerSearchQuery(term);
  const { results: page, status } = usePaginatedQuery(
    gateway.catalog.search,
    searchTerm ? { searchTerm } : "skip",
    { initialNumItems: SEARCH_LIMIT },
  );
  const { data: barcodeMatch, isFetching: barcodeFetching } = useQuery(
    convexQuery(
      gateway.catalog.lookupBarcode,
      barcode ? { code: barcode } : "skip",
    ),
  );
  return {
    results: pickerSearchResults({ barcode, barcodeMatch, page }),
    isSearching: barcode
      ? barcodeFetching
      : !!searchTerm && status === "LoadingFirstPage",
  };
}

// The multi-select catalogue picker: search, pick many, optionally offer each for swap, and add
// them all with one `library.acquireCopies` call (all or nothing). `returnTo` is where
// "Register" comes back to after the full add form.
export function CataloguePicker({
  returnTo,
  onAdded,
}: {
  returnTo?: string;
  onAdded?: (copyIds: string[]) => void;
}) {
  const t = useTranslations("cataloguePicker");
  const [term, setTerm] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const deferredTerm = useDeferredValue(term);

  const { member } = useCurrentMember();
  const { results, isSearching } = useCatalogueSearch(deferredTerm);
  // The member's own not-yet-approved submissions: acquirable by them, absent from the search.
  const { data: mySubmissions } = useQuery(
    convexQuery(gateway.catalog.myContributedPuzzles, member ? {} : "skip"),
  );
  // Same args as the dashboard shelf, so the subscription is shared.
  const { data: copies } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      member?._id
        ? { ownerId: member._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );

  const rows = useMemo(
    () =>
      buildPickerRows({
        term: deferredTerm,
        results,
        mySubmissions: mySubmissions ?? [],
        ownedDefinitionIds: new Set(
          (copies ?? []).flatMap((c) =>
            c.puzzleDefinitionId ? [c.puzzleDefinitionId] : [],
          ),
        ),
      }),
    [deferredTerm, results, mySubmissions, copies],
  );

  const acquireCopies = useConvexMutation(gateway.library.acquireCopies);
  const submit = useMutation({
    mutationFn: () => acquireCopies({ items: toAcquireItems(picks) }),
    onSuccess: ({ copyIds }) => {
      toast.success(t("added", { count: copyIds.length }));
      setPicks([]);
      setTerm("");
      onAdded?.(copyIds);
    },
    onError: (error) => {
      console.error("Batch add failed:", error);
      toast.error(t("addFailed"));
    },
  });

  return (
    <CataloguePickerView
      term={term}
      rows={rows}
      picks={picks}
      isSearching={isSearching}
      isSubmitting={submit.isPending}
      returnTo={returnTo}
      onTermChange={setTerm}
      onToggle={(row) => setPicks((current) => togglePick(current, row))}
      onRemove={(id) => setPicks((current) => removePick(current, id))}
      onRemoveLast={() => setPicks((current) => removeLastPick(current))}
      onForTradeChange={(id, forTrade) =>
        setPicks((current) => setPickForTrade(current, id, forTrade))
      }
      onSubmit={() => submit.mutate()}
    />
  );
}
