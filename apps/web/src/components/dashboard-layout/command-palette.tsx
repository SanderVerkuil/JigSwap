"use client";

// ⌘K command palette: a real global search across Puzzles, the member's own copies ("In your
// library"), People, Circles and the member's Collections (gateway.search.global) plus the static
// "Go To" nav destinations and quick actions.
// The destinations and quick actions are ALWAYS listed: cmdk filters them (see paletteFilter) on
// their localized title plus bilingual keywords (route-meta), so typing "gol", "mess" or "ruil"
// still reaches Goals, Messages or Exchanges. From MIN_TERM_LENGTH characters the live result groups render
// above them, with a "Searching…" row while the query runs; the empty text shows only when the
// search is done and nothing at all matches. With an empty input the palette is a pure jump-to
// navigator. Opened from the top-bar search control or Cmd/Ctrl+K. It opens
// and closes without animation, because it is pressed many times a day; other dialogs keep theirs.
import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
import { useDataExport } from "@/components/insights/export-button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { gateway } from "@/gateway";
// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { defaultFilter } from "cmdk";
import { useConvexAuth } from "convex/react";
import {
  Blend,
  BookOpen,
  CircleCheck,
  Download,
  FolderOpen,
  History,
  Plus,
  Puzzle,
  Search,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import {
  ADMIN_GROUP,
  DASHBOARD_ITEM,
  NAV_GROUPS,
  type ShellNavItem,
} from "./route-meta";

// Keywords as in route-meta: English and Dutch synonyms, so either language finds the action.
const QUICK_ACTIONS = [
  {
    key: "addAPuzzle",
    href: "/my-puzzles/add",
    icon: Plus,
    keywords: ["add", "new", "toevoegen", "nieuw"],
  },
  {
    key: "logCompletion",
    href: "/completions/new",
    icon: CircleCheck,
    keywords: [
      "log",
      "solve",
      "finish",
      "complete",
      "completion",
      "vastleggen",
      "voltooiing",
    ],
  },
  {
    key: "markPastSolves",
    href: "/completions/past",
    icon: History,
    keywords: ["past", "earlier", "backfill", "eerdere", "afgemaakt"],
  },
  {
    key: "createCircle",
    // Opens the create dialog on arrival (circles-search.ts).
    href: "/circles?create=1",
    icon: Blend,
    keywords: ["create", "new circle", "kring", "aanmaken", "maak"],
  },
  {
    key: "browseCommunity",
    href: "/browse",
    icon: Search,
    keywords: ["browse", "discover", "verkennen", "ontdekken"],
  },
] as const;

// The data export is a quick action too, but a direct one (it downloads in place), so no href.
const EXPORT_DATA_KEYWORDS = [
  "export",
  "download",
  "data",
  "exporteer",
  "exporteren",
  "downloaden",
  "gegevens",
] as const;

// What a search word may add to a title's or keyword's word: a plain English or Dutch ending, with
// the word's last letter doubled or not. Matched from that last letter on (see inflects).
const WORD_ENDING = /^(.)\1?(?:s|es|d|ed|er|ers|ing|n|en|t|te|ten|de|den)$/;

// Whether a search word is a form of a title's or keyword's word: "trades" and "trading" of "trade",
// "swapped" of "swap", "ruilt" of "ruil". Not just any word that starts with it: "login" isn't "log".
function inflects(term: string, word: string) {
  const stem = word.replace(/e$/, "");
  return (
    stem.length >= 3 &&
    term.startsWith(stem) &&
    WORD_ENDING.test(term.slice(stem.length - 1))
  );
}

// Whether every word of the search matches a title or keyword: as one piece anywhere in it, as
// letters in order inside one word, starting at the word's first letter ("gol" finds Goals), or as
// a form of one word. cmdk's default also takes letters scattered across the words and keywords,
// which listed People and My Puzzles for "mess". Its score still ranks what's left, so the best
// match stays first.
function paletteFilter(value: string, search: string, keywords?: string[]) {
  const texts = [value, ...(keywords ?? [])].map((text) => text.toLowerCase());
  const inOrderIn = (term: string, word: string) => {
    let matched = 0;
    for (const letter of word) if (letter === term[matched]) matched++;
    return word[0] === term[0] && matched === term.length;
  };
  const matches = search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) =>
      texts.some(
        (text) =>
          text.includes(term) ||
          text
            .split(/\s+/)
            .some((word) => inOrderIn(term, word) || inflects(term, word)),
      ),
    );
  // At least a sliver: cmdk's score is 0 for words typed in another order, which still match here.
  return matches ? Math.max(defaultFilter(value, search, keywords), 0.01) : 0;
}

// Minimum term length before we hit the backend; mirrors the query's own short-circuit.
const MIN_TERM_LENGTH = 2;
const DEBOUNCE_MS = 200;

export function CommandPalette({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const t = useTranslations("shell");
  const displayName = useMemberDisplayName();
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  // "Export my data" runs here rather than linking to the page that hosts the button.
  const { exportData, busy: exporting } = useDataExport();

  // Raw input value (drives cmdk) and the debounced term we actually search on.
  const [value, setValue] = useState("");
  const [term, setTerm] = useState("");

  // Single close path: clears a stale query so it doesn't flash on reopen. Used
  // by the dialog, the keyboard toggle and navigation, so the reset never has
  // to live in an effect body.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setValue("");
      setTerm("");
    }
    setOpen(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handleOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // handleOpenChange is recreated each render; re-bind only when `open` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce the input into the searched term.
  useEffect(() => {
    const handle = setTimeout(() => setTerm(value.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value]);

  const hasTerm = term.length >= MIN_TERM_LENGTH;
  const { data: results } = useQuery(
    convexQuery(
      gateway.search.global,
      hasTerm && isAuthenticated ? { term } : "skip",
    ),
  );
  // Searching from the first searchable keystroke until the results for exactly that input land
  // (the debounce window included), so the empty text never flashes for a search still to come.
  const typed = value.trim();
  const isSearching =
    isAuthenticated &&
    typed.length >= MIN_TERM_LENGTH &&
    (typed !== term || results === undefined);
  // Web deploys before Convex, and a failed or superseded backend deploy can keep it that way for
  // longer, so a backend that doesn't return `copies` yet must not crash the app.
  const copies = results?.copies ?? [];

  // Backend-confirmed admin role — same source as the /admin route guard and
  // the sidebar's gated group; Convex dedupes the shared subscription.
  const { data: isAdmin } = useQuery(
    convexQuery(gateway.identity.isAdmin, user?.id ? {} : "skip"),
  );

  const go = (href: string) => {
    handleOpenChange(false);
    router.push(href);
  };

  // Group landings included so every destination in the IA is reachable. The
  // admin group's destinations appear only for admins.
  const destinations: ShellNavItem[] = [
    DASHBOARD_ITEM,
    ...[...NAV_GROUPS, ...(isAdmin ? [ADMIN_GROUP] : [])].flatMap((group) => [
      {
        key: group.key,
        href: group.href,
        icon: group.icon,
        keywords: group.keywords,
      },
      ...group.items,
    ]),
  ];

  // cmdk filters items against the input value; result rows are server-side matches we always want
  // visible, so each carries a value prefixed with the raw input so cmdk keeps it.
  const keep = (id: string) => `${value} ${id}`;

  const goTo = destinations.map((item) => ({
    ...item,
    title: t(`pages.${item.key}.title`),
  }));
  const quickActions = QUICK_ACTIONS.map((action) => ({
    ...action,
    title: t(`actions.${action.key}`),
  }));
  const exportAction = {
    title: t("actions.exportData"),
    keywords: EXPORT_DATA_KEYWORDS,
  };

  // cmdk ranks items inside a group but never reorders the groups, and it highlights the first
  // match. So the static group holding the best match goes first: "add" then Enter adds a puzzle
  // instead of opening Exchanges. Scored with the palette's own filter, on the same raw input.
  const bestScore = (
    entries: ReadonlyArray<{ title: string; keywords?: readonly string[] }>,
  ) =>
    Math.max(
      0,
      ...entries.map((entry) =>
        paletteFilter(entry.title, value, [...(entry.keywords ?? [])]),
      ),
    );
  const actionsFirst =
    typed.length > 0 &&
    bestScore([...quickActions, exportAction]) > bestScore(goTo);

  const goToGroup = (
    <CommandGroup key="go-to" heading={t("search.goTo")}>
      {goTo.map((item) => (
        <CommandItem
          key={item.href}
          value={item.title}
          keywords={item.keywords ? [...item.keywords] : undefined}
          onSelect={() => go(item.href)}
        >
          <item.icon />
          <span>{item.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
  const quickActionsGroup = (
    <CommandGroup key="quick-actions" heading={t("search.quickActions")}>
      {quickActions.map((action) => (
        <CommandItem
          key={action.key}
          value={action.title}
          keywords={[...action.keywords]}
          onSelect={() => go(action.href)}
        >
          <action.icon />
          <span>{action.title}</span>
        </CommandItem>
      ))}
      <CommandItem
        value={exportAction.title}
        keywords={[...exportAction.keywords]}
        disabled={exporting}
        onSelect={() => {
          handleOpenChange(false);
          void exportData();
        }}
      >
        <Download />
        <span>{exportAction.title}</span>
      </CommandItem>
    </CommandGroup>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("search.label")}
      description={t("search.inputPlaceholder")}
      filter={paletteFilter}
      // The dialog primitive animates on data-state, so match it; the backdrop is the sibling before.
      className="data-[state=closed]:animate-none! data-[state=open]:animate-none [[data-slot=dialog-overlay]:has(+&)]:animate-none!"
    >
      <CommandInput
        placeholder={t("search.inputPlaceholder")}
        value={value}
        onValueChange={setValue}
      />
      <CommandList className="[scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_transparent] [scrollbar-width:thin]">
        {isSearching ? (
          <div
            data-slot="command-searching"
            role="presentation"
            className="text-muted-foreground px-3 py-3 text-center text-sm"
          >
            {t("search.searching")}
          </div>
        ) : (
          <CommandEmpty>
            {typed
              ? t("search.noResultsFor", { term: typed })
              : t("search.empty")}
          </CommandEmpty>
        )}

        {/* The member's own copies come first: someone typing a title they own most likely
            wants their copy, not the catalogue entry. */}
        {copies.length > 0 ? (
          <CommandGroup heading={t("search.groupLibrary")}>
            {copies.map((hit) => (
              <CommandItem
                key={hit.id}
                value={keep(hit.id)}
                onSelect={() => go(hit.href)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hit.image}
                    alt=""
                    className="size-5 rounded object-cover"
                  />
                ) : (
                  <BookOpen />
                )}
                <span>{hit.title}</span>
                {hit.brand ? (
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {hit.brand}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.puzzles.length > 0 ? (
          <CommandGroup heading={t("search.groupPuzzles")}>
            {results.puzzles.map((hit) => (
              <CommandItem
                key={hit.id}
                value={keep(hit.id)}
                onSelect={() => go(hit.href)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hit.image}
                    alt=""
                    className="size-5 rounded object-cover"
                  />
                ) : (
                  <Puzzle />
                )}
                <span>{hit.title}</span>
                {hit.brand ? (
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {hit.brand}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.people.length > 0 ? (
          <CommandGroup heading={t("search.groupPeople")}>
            {results.people.map((hit) => (
              <CommandItem
                key={hit.id}
                value={keep(hit.id)}
                onSelect={() => go(hit.href)}
              >
                {hit.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={hit.image}
                    alt=""
                    className="size-5 rounded-full object-cover"
                  />
                ) : (
                  <User />
                )}
                <span>{displayName({ name: hit.name })}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.circles.length > 0 ? (
          <CommandGroup heading={t("search.groupCircles")}>
            {results.circles.map((hit) => (
              <CommandItem
                key={hit.id}
                value={keep(hit.id)}
                onSelect={() => go(hit.href)}
              >
                <Blend />
                <span>{hit.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results && results.collections.length > 0 ? (
          <CommandGroup heading={t("search.groupCollections")}>
            {results.collections.map((hit) => (
              <CommandItem
                key={hit.id}
                value={keep(hit.id)}
                onSelect={() => go(hit.href)}
              >
                <FolderOpen />
                <span>{hit.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {actionsFirst ? (
          <>
            {quickActionsGroup}
            {goToGroup}
          </>
        ) : (
          <>
            {goToGroup}
            <CommandSeparator />
            {quickActionsGroup}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
