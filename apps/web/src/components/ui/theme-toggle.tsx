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
          <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
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
