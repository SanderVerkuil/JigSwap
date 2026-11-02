import { LIBRARY_ROWS_MAX } from "@jigswap/contracts";
import { useTranslations } from "use-intl";

/**
 * Says so when a picker that offers a whole library got as many copies as one read joins: older ones
 * were left out (LIBRARY_ROWS_MAX).
 */
export function PickerCapNote({ shown }: { shown: number }) {
  const t = useTranslations("puzzles");
  if (shown < LIBRARY_ROWS_MAX) return null;
  return (
    <p className="text-muted-foreground text-sm">
      {t("pickerAtMax", { max: LIBRARY_ROWS_MAX })}
    </p>
  );
}
