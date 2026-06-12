"use client";

// ⌘K command palette: every nav destination ("Go To") plus a handful of
// quick actions. Opened from the top-bar search pill or Cmd/Ctrl+K.

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
import { CircleCheck, Plus, Search, Users } from "lucide-react";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { DASHBOARD_ITEM, NAV_GROUPS } from "./route-meta";

const QUICK_ACTIONS = [
  { key: "addAPuzzle", href: "/my-puzzles/add", icon: Plus },
  { key: "logCompletion", href: "/completions", icon: CircleCheck },
  { key: "createCircle", href: "/circles", icon: Users },
  { key: "browseCommunity", href: "/browse", icon: Search },
] as const;

export function CommandPalette({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const t = useTranslations("shell");
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  // Group landings included so every destination in the IA is reachable.
  const destinations = [
    DASHBOARD_ITEM,
    ...NAV_GROUPS.flatMap((group) => [
      { key: group.key, href: group.href, icon: group.icon },
      ...group.items,
    ]),
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("search.label")}
      description={t("search.inputPlaceholder")}
    >
      <CommandInput placeholder={t("search.inputPlaceholder")} />
      <CommandList>
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
      </CommandList>
    </CommandDialog>
  );
}
