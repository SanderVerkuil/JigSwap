"use client";

// RHF-integrated field for Record<locale, string> values (e.g. { en, nl }).
// Each field renders a segmented pill toggle (presence dot + locale code) in
// its label row (presence dots are per-field information), but the selected
// locale is SYNCED across all fields through TranslatableFieldsProvider —
// switching one toggle visibly flips every field, which is what reveals the
// sync. All locale inputs stay mounted; non-active ones are display:none
// (`hidden`), so nothing typed is ever lost and hidden inputs are untabbable.
// Only the field marked `primaryToggle` exposes its toggle to keyboard and
// screen readers; the other toggles are pointer-only duplicates, so Tab goes
// input → input instead of stopping at every copy of the same control.

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

// The base locale every other translation is authored against; its value
// previews under the field while a non-base locale is active.
const BASE_LOCALE: Locale = "en";

export function TranslatableField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  required = false,
  multiline = false,
  primaryToggle = false,
}: {
  control: Control<TFieldValues>;
  /** Base path of the Record<locale, string> object (e.g. "name"). */
  name: FieldPath<TFieldValues>;
  label: string;
  required?: boolean;
  multiline?: boolean;
  /**
   * Marks this field's toggle as THE keyboard/screen-reader locale switch
   * (roving-tabindex radiogroup). Set it on the first TranslatableField of a
   * form; the other fields' toggles become pointer-only duplicates.
   */
  primaryToggle?: boolean;
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
          // Radiogroup semantics live on the primary toggle only; the other
          // toggles are pointer-only duplicates hidden from assistive tech so
          // screen readers hear ONE locale switch, not one per field.
          {...(primaryToggle
            ? {
                role: "radiogroup" as const,
                "aria-label": t("toggleLabel", { field: label }),
              }
            : { "aria-hidden": true })}
          onKeyDown={primaryToggle ? handleToggleKeyDown : undefined}
          className="inline-flex items-center gap-0.5 rounded-full border p-0.5"
        >
          {locales.map((locale) => {
            const active = locale === activeLocale;
            const error = getError(errors, localePath(locale));
            const filled = Boolean(values[locale]?.trim());
            // Dot per segment: error (after touch/submit) beats presence;
            // blank + no error renders a hollow outline dot.
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
                    tabIndex={primaryToggle && active ? 0 : -1}
                    data-locale={locale}
                    onClick={() => setActiveLocale(locale)}
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        state === "error" && "bg-destructive",
                        state === "filled" && "bg-jigsaw-success",
                        // Hollow dot; currentColor keeps it visible on the
                        // inverted active segment.
                        state === "empty" && "border border-current opacity-50",
                      )}
                    />
                    {locale.toUpperCase()}
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
              {/* While translating, keep the base (en) text in view. */}
              {locale !== BASE_LOCALE &&
                Boolean(values[BASE_LOCALE]?.trim()) && (
                  <p className="text-muted-foreground mt-1 truncate text-xs">
                    {BASE_LOCALE.toUpperCase()}: {values[BASE_LOCALE]}
                  </p>
                )}
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
