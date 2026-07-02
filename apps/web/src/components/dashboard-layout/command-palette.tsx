"use client";

// ⌘K command palette: a real global search across Puzzles, People, Circles and the member's
// Collections (gateway.search.global) plus the static "Go To" nav destinations and quick actions.
// While a term is typed, live result groups render above the nav fallback; with an empty input the
// palette is a pure jump-to navigator. Opened from the top-bar search pill or Cmd/Ctrl+K.

import { useUser } from "@/compat/clerk";
import { useRouter } from "@/compat/navigation";
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
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: useConvexAuth (see tanstack-query migration spec)
import { useConvexAuth } from "convex/react";
import {
  CircleCheck,
  FolderOpen,
  Plus,
  Puzzle,
  Search,
  User,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { ADMIN_GROUP, DASHBOARD_ITEM, NAV_GROUPS } from "./route-meta";

const QUICK_ACTIONS = [
  { key: "addAPuzzle", href: "/my-puzzles/add", icon: Plus },
  { key: "logCompletion", href: "/completions", icon: CircleCheck },
  { key: "createCircle", href: "/circles", icon: Users },
  { key: "browseCommunity", href: "/browse", icon: Search },
] as const;

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
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();

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
  const isSearching = hasTerm && results === undefined;
  const totalHits = results
    ? results.puzzles.length +
      results.people.length +
      results.circles.length +
      results.collections.length
    : 0;

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
  const destinations = [
    DASHBOARD_ITEM,
    ...[...NAV_GROUPS, ...(isAdmin ? [ADMIN_GROUP] : [])].flatMap((group) => [
      { key: group.key, href: group.href, icon: group.icon },
      ...group.items,
    ]),
  ];

  // cmdk filters items against the input value; result rows are server-side matches we always want
  // visible, so each carries a value prefixed with the raw input so cmdk keeps it.
  const keep = (id: string) => `${value} ${id}`;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("search.label")}
      description={t("search.inputPlaceholder")}
    >
      <CommandInput
        placeholder={t("search.inputPlaceholder")}
        value={value}
        onValueChange={setValue}
      />
      <CommandList>
        {hasTerm ? (
          <>
            {isSearching ? (
              <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                {t("search.searching")}
              </div>
            ) : totalHits === 0 ? (
              <div className="text-muted-foreground px-3 py-6 text-center text-sm">
                {t("search.noResultsFor", { term })}
              </div>
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
                    <span>{hit.name}</span>
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
                    <Users />
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
          </>
        ) : (
          <>
            <CommandEmpty>{t("search.empty")}</CommandEmpty>
            <CommandGroup heading={t("search.goTo")}>
              {destinations.map((item) => (
                <CommandItem key={item.href} onSelect={() => go(item.href)}>
                  <item.icon />
                  <span>{t(`pages.${item.key}.title`)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={t("search.quickActions")}>
              {QUICK_ACTIONS.map((action) => (
                <CommandItem key={action.key} onSelect={() => go(action.href)}>
                  <action.icon />
                  <span>{t(`actions.${action.key}`)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
