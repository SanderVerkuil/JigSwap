"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { useTranslations } from "use-intl";

export const THEMES = ["light", "dark", "system"] as const;

const noopSubscribe = () => () => {};

// The member's theme choice. next-themes reads it from localStorage, which the server cannot see,
// so it is undefined until hydration: the server render and the first client render must agree.
export function useThemeChoice() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const current = hydrated
    ? THEMES.find((choice) => choice === theme)
    : undefined;
  return { theme: current, setTheme };
}

export function ModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useThemeChoice();
  const t = useTranslations("shell.theme");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className}>
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 opacity-100 transition-[scale,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none dark:scale-90 dark:opacity-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-90 opacity-0 transition-[scale,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none dark:scale-100 dark:opacity-100" />
          <span className="sr-only">
            {theme ? `${t("toggle")}: ${t(theme)}` : t("toggle")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? ""} onValueChange={setTheme}>
          {THEMES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {t(choice)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
