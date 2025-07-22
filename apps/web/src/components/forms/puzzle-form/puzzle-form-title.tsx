"use client";

import { useTranslations } from "next-intl";

export function PuzzleFormTitle() {
  const t = useTranslations("puzzles");

  return (
    <div>
      <h1 className="text-3xl font-bold">{t("addPuzzle")}</h1>
      <p className="text-muted-foreground">{t("addPuzzleDescription")}</p>
    </div>
  );
}
