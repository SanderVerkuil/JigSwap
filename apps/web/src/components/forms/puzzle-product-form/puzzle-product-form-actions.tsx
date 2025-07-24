import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { usePuzzleProductFormContext } from "./puzzle-product-form-context";

export const PuzzleProductFormActions = () => {
  const { formId, isPending, onCancel } = usePuzzleProductFormContext();
  const t = useTranslations("forms.puzzle-product-form");

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
