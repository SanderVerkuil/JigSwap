"use client";

// RHF-integrated field for Record<locale, string> values (e.g. { en, nl }).
// Each field renders a segmented flag toggle in its label row (presence dots
// are per-field information), but the selected locale is SYNCED across all
// fields through TranslatableFieldsProvider — switching one toggle visibly
// flips every field, which is what reveals the sync. All locale inputs stay
// mounted; non-active ones are display:none (`hidden`), so nothing typed is
// ever lost and hidden inputs are untabbable.

import { Flag } from "@/components/ui/flag";
import { FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { locales as allLocales, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useFormState,
  useWatch,
  type Control,
  type FieldErrors,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { useLocale, useTranslations } from "use-intl";

type TranslatableFieldsContextValue = {
  locales: readonly Locale[];
  activeLocale: Locale;
  setActiveLocale: (locale: Locale) => void;
};

const TranslatableFieldsContext =
  createContext<TranslatableFieldsContextValue | null>(null);

export function useTranslatableFields() {
  const context = useContext(TranslatableFieldsContext);
  if (!context) {
    throw new Error(
      "useTranslatableFields must be used within a TranslatableFieldsProvider",
    );
  }
  return context;
}

export function TranslatableFieldsProvider({
  locales = allLocales,
  children,
}: {
  /** Locales the fields edit; defaults to the app's supported locales. */
  locales?: readonly Locale[];
  children: ReactNode;
}) {
  // Start on the current UI locale when the field set supports it.
  const uiLocale = useLocale();
  const [activeLocale, setActiveLocale] = useState<Locale>(() =>
    (locales as readonly string[]).includes(uiLocale)
      ? (uiLocale as Locale)
      : locales[0],
  );
  const value = useMemo(
    () => ({ locales, activeLocale, setActiveLocale }),
    [locales, activeLocale],
  );
  return (
    <TranslatableFieldsContext.Provider value={value}>
      {children}
    </TranslatableFieldsContext.Provider>
  );
}

// Reads a dot-separated path out of the RHF errors tree.
function getError(errors: FieldErrors, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      errors,
    );
}

export function TranslatableField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  required = false,
  multiline = false,
}: {
  control: Control<TFieldValues>;
  /** Base path of the Record<locale, string> object (e.g. "name"). */
  name: FieldPath<TFieldValues>;
  label: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const t = useTranslations("forms.translatable-field");
  const { locales, activeLocale, setActiveLocale } = useTranslatableFields();
  const id = useId();
  const toggleRef = useRef<HTMLDivElement>(null);

  const localePath = (locale: Locale) =>
    `${name}.${locale}` as FieldPath<TFieldValues>;

  // Presence dots need every locale's value and error, not just the visible one.
  const values = (useWatch({ control, name }) ?? {}) as Partial<
    Record<Locale, string>
  >;
  const { errors } = useFormState({ control, name: locales.map(localePath) });

  // Radiogroup semantics: one tab stop, arrow keys move between locales.
  const handleToggleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const index = locales.indexOf(activeLocale);
    const next = locales[(index + delta + locales.length) % locales.length];
    setActiveLocale(next);
    toggleRef.current
      ?.querySelector<HTMLButtonElement>(`[data-locale="${next}"]`)
      ?.focus();
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${id}-${activeLocale}`}>{label}</Label>
        <div
          ref={toggleRef}
          role="radiogroup"
          aria-label={t("toggleLabel", { field: label })}
          onKeyDown={handleToggleKeyDown}
          className="inline-flex rounded-md border bg-muted p-0.5"
        >
          {locales.map((locale) => {
            const active = locale === activeLocale;
            const error = getError(errors, localePath(locale));
            const filled = Boolean(values[locale]?.trim());
            // Dot per segment: error (after touch/submit) beats presence;
            // blank + no error shows nothing.
            const state = error ? "error" : filled ? "filled" : "empty";
            const languageName = t(`locales.${locale}`);
            return (
              <Tooltip key={locale}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${languageName} — ${
                      state === "filled" ? t("translated") : t("missing")
                    }`}
                    tabIndex={active ? 0 : -1}
                    data-locale={locale}
                    onClick={() => setActiveLocale(locale)}
                    className={cn(
                      "relative inline-flex h-6 items-center justify-center rounded-sm px-1.5 outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active
                        ? "bg-background shadow-sm"
                        : "opacity-60 hover:opacity-100",
                    )}
                  >
                    <Flag locale={locale} />
                    {state !== "empty" && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-background",
                          state === "error"
                            ? "bg-destructive"
                            : "bg-jigsaw-success",
                        )}
                      />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{languageName}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      {locales.map((locale) => (
        <FormField
          key={locale}
          control={control}
          name={localePath(locale)}
          render={({ field, fieldState }) => (
            <FormItem className={cn(locale !== activeLocale && "hidden")}>
              {multiline ? (
                <Textarea
                  rows={2}
                  {...field}
                  id={`${id}-${locale}`}
                  value={(field.value ?? "") as string}
                  aria-invalid={fieldState.invalid}
                  aria-required={required || undefined}
                />
              ) : (
                <Input
                  {...field}
                  id={`${id}-${locale}`}
                  value={(field.value ?? "") as string}
                  aria-invalid={fieldState.invalid}
                  aria-required={required || undefined}
                />
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
