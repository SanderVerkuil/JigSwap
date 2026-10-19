import { Hourglass } from "lucide-react";
import { useTranslations } from "use-intl";

// The "being checked" label on a puzzle's cover placeholder, shown to the uploader of box art
// that is not served yet (hooks/use-box-art-check). Sits at the bottom of a `relative` cover.
export function BoxArtCheckingLabel() {
  const t = useTranslations("puzzles.boxArtCheck");
  return (
    <span className="absolute inset-x-2 bottom-2 z-[2] flex items-center justify-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm">
      <Hourglass className="size-3.5 shrink-0" aria-hidden />
      <span className="text-center leading-tight">{t("label")}</span>
    </span>
  );
}
