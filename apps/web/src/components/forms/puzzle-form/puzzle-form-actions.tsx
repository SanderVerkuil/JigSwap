import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { usePuzzleFormContext } from "./puzzle-form-context";

export const PuzzleFormActions = () => {
  const { formId, isPending, onCancel } = usePuzzleFormContext();
  const t = useTranslations("forms.puzzle-form");

  return (
    <div className="flex gap-2 justify-end">
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
          role="button"
        >
          {t("actions.cancel")}
        </Button>
      )}
      <Button type="submit" form={formId} disabled={isPending}>
        {isPending ? t("actions.submitting") : t("actions.submit")}
      </Button>
    </div>
  );
};
