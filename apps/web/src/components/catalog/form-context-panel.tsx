import { ChangedFieldChips } from "@/components/suggest-edit/changed-field-chips";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// Shared right-column chrome for the puzzle-definition edit forms (member suggest-edit +
// admin direct edit): the caller's own cover-image control, a live "Changes (N)" summary,
// and the caller's own Cancel/Submit action row. This component owns no dirty-tracking
// logic itself — `changes` is whatever record the page's existing buildProposalArgs/dirty
// state produced, and the field-label lookup is reused as-is from ChangedFieldChips (the
// same component the admin queue/history/my-suggestions rows use), so no diff logic or
// label mapping is duplicated here.
export function FormContextPanel({
  image,
  changes,
  actions,
}: {
  image: ReactNode;
  changes: Record<string, unknown>;
  actions: ReactNode;
}) {
  const t = useTranslations("suggestEdit");
  const count = Object.values(changes).filter((v) => v !== undefined).length;

  return (
    <div className="flex flex-col gap-6">
      {image}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("changesHeading", { count })}</p>
        {count === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noChangesYet")}</p>
        ) : (
          <ChangedFieldChips changes={changes} />
        )}
      </div>
      {actions}
    </div>
  );
}
