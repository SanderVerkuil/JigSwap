import { CONDITION_VALUES } from "@/components/add-puzzle/add-puzzle-schema";
import type { CopyCondition } from "@jigswap/contracts";
import { useTranslations } from "use-intl";

// One vocabulary for a copy's condition. Every surface that names one (the add form and copy
// editor pickers, the copy cards, the copy page and the catalogue's "you own a copy" line) reads
// the `condition.<value>` locale map through these helpers, so the word a member picks is the
// word they see after saving.

export function useConditionLabel(): (condition: CopyCondition) => string {
  const t = useTranslations("condition");
  return (condition) => t(condition);
}

/** The picker's options: every condition a copy can have, best first. */
export function useConditionOptions(): Array<{
  value: CopyCondition;
  label: string;
}> {
  const label = useConditionLabel();
  return CONDITION_VALUES.map((value) => ({ value, label: label(value) }));
}

/** The colour of the dot shown next to a condition's label. */
export function conditionDotClass(condition: CopyCondition): string {
  switch (condition) {
    case "new_sealed":
    case "like_new":
      return "bg-jigsaw-secondary";
    case "good":
      return "bg-jigsaw-primary";
    case "fair":
      return "bg-amber-400";
    case "poor":
      return "bg-destructive";
  }
}
