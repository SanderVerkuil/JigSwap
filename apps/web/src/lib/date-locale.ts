import { type Locale as DateFnsLocale } from "date-fns";
import { enUS, nl } from "date-fns/locale";
import { useLocale } from "use-intl";

// Maps the active use-intl locale to its date-fns counterpart so relative-time
// helpers (formatDistanceToNow, etc.) render in the user's language instead of
// always defaulting to English. Defaults to en-US for any unknown locale.
const DATE_FNS_LOCALES: Record<string, DateFnsLocale> = {
  en: enUS,
  nl,
};

export function useDateFnsLocale(): DateFnsLocale {
  const locale = useLocale();
  return DATE_FNS_LOCALES[locale] ?? enUS;
}
