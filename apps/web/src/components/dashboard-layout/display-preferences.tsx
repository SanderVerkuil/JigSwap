"use client";

// Theme and language as segmented radio groups, for the places that have no top-bar menus for
// them: the phone quick sheet and the Preferences page in the account modal. Same choices and
// switching as the desktop menus (ui/theme-toggle, ui/language-switcher); 44px tall on touch
// screens. On the keyboard they behave like native radios: the group is one Tab stop and the
// arrow keys move and select.
import { Flag } from "@/components/ui/flag";
import { LANGUAGES, useChangeLocale } from "@/components/ui/language-switcher";
import { THEMES, useThemeChoice } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import type { KeyboardEvent, ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

const ARROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** Arrow keys on a radiogroup of buttons: focus and select the next radio, wrapping at the ends. */
export function moveRadioWithArrows(event: KeyboardEvent<HTMLElement>) {
  const step = ARROW_STEP[event.key];
  if (!step) return;
  const radios = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]"),
  );
  const current = radios.indexOf(event.target as HTMLElement);
  const next = radios[(current + step + radios.length) % radios.length];
  event.preventDefault();
  next?.focus();
  next?.click();
}

export function ThemeRadios() {
  const t = useTranslations("shell.theme");
  const { theme, setTheme } = useThemeChoice();

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      onKeyDown={moveRadioWithArrows}
      className="flex gap-2"
    >
      {THEMES.map((choice, index) => (
        <Segment
          key={choice}
          selected={theme === choice}
          // Until the stored theme is known nothing is checked, and the group still needs a stop.
          tabStop={theme ? theme === choice : index === 0}
          onSelect={() => setTheme(choice)}
        >
          {t(choice)}
        </Segment>
      ))}
    </div>
  );
}

export function LanguageRadios() {
  const t = useTranslations("shell.language");
  const locale = useLocale();
  const changeLocale = useChangeLocale();

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      onKeyDown={moveRadioWithArrows}
      className="flex gap-2"
    >
      {LANGUAGES.map((language) => (
        <Segment
          key={language.code}
          lang={language.code}
          selected={locale === language.code}
          tabStop={locale === language.code}
          onSelect={() => void changeLocale(language.code)}
        >
          <Flag locale={language.code} />
          {language.name}
        </Segment>
      ))}
    </div>
  );
}

// Styled like the Preferences page's content-width choice.
function Segment({
  selected,
  tabStop,
  onSelect,
  lang,
  children,
}: {
  selected: boolean;
  tabStop: boolean;
  onSelect: () => void;
  lang?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabStop ? 0 : -1}
      lang={lang}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-sm transition-colors pointer-coarse:min-h-11",
        selected
          ? "border-primary bg-primary/10 font-medium text-foreground"
          : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
