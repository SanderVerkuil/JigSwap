import { solvingErrorCode } from "@/components/solving/solving-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import {
  GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_TITLE_MAX_LENGTH,
  goalFormErrorsFromCode,
  goalFormValues,
  minGoalEndDate,
  validateGoalForm,
  type GoalFormErrors,
  type GoalFormMode,
  type GoalFormValues,
} from "@/lib/goal-form";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import type { GoalRow } from "./goal-row";

// A goal the goal mutations can address (rows written before aggregateIds existed can't be).
export type EditableGoal = GoalRow & { aggregateId: string };

export const isEditableGoal = (goal: GoalRow): goal is EditableGoal =>
  goal.aggregateId !== undefined;

const FIELD_ID = {
  title: "goal-title",
  description: "goal-description",
  target: "goal-target",
  from: "goal-from",
  to: "goal-to",
} as const;

const errorId = (field: keyof GoalFormErrors) => `${FIELD_ID[field]}-error`;

// Create a goal, or edit one (`goal` set): the same form, prefilled for an edit. Submit is always
// enabled; it checks the whole form (lib/goal-form validateGoalForm) and shows what to fix next
// to each field, moving focus to the first one. Updates send the whole definition, since the
// server replaces it.
export function GoalFormDialog({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: EditableGoal;
}) {
  const t = useTranslations("solving.goals");
  const mode: GoalFormMode = goal ? "edit" : "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit" ? t("editDescription") : t("createDescription")}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from fresh values. */}
        <GoalForm goal={goal} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden className="text-destructive -ml-1">
      *
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive text-xs">
      {message}
    </p>
  );
}

function GoalForm({
  goal,
  onDone,
}: {
  goal?: EditableGoal;
  onDone: () => void;
}) {
  const t = useTranslations("solving.goals");
  const tCommon = useTranslations("common");
  const mode: GoalFormMode = goal ? "edit" : "create";

  const [values, setValues] = useState<GoalFormValues>(() =>
    goalFormValues(goal),
  );
  const [errors, setErrors] = useState<GoalFormErrors>({});

  const createGoal = useMutation({
    mutationFn: useConvexMutation(gateway.solving.createGoal),
  });
  const updateGoal = useMutation({
    mutationFn: useConvexMutation(gateway.solving.updateGoal),
  });
  const pending = createGoal.isPending || updateGoal.isPending;

  const change =
    (field: keyof GoalFormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { value } = event.target;
      setValues((current) => ({ ...current, [field]: value }));
      // A changed date can fix or cause the period error, so it clears with either date.
      const clears: keyof GoalFormErrors | undefined =
        field === "title" || field === "description" || field === "target"
          ? field
          : field === "from" || field === "to"
            ? "to"
            : undefined;
      if (clears) {
        setErrors((current) => ({ ...current, [clears]: undefined }));
      }
    };

  const showErrors = (next: GoalFormErrors) => {
    setErrors(next);
    const first = (["title", "description", "target", "to"] as const).find(
      (f) => next[f],
    );
    if (first) document.getElementById(FIELD_ID[first])?.focus();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = validateGoalForm(values, { mode });
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    try {
      if (goal) {
        await updateGoal.mutateAsync({
          goalId: goal.aggregateId,
          ...result.definition,
        });
        toast.success(t("updated"));
      } else {
        await createGoal.mutateAsync(result.definition);
        toast.success(t("created"));
      }
      onDone();
    } catch (error) {
      const fieldErrors = goalFormErrorsFromCode(solvingErrorCode(error));
      if (fieldErrors) {
        showErrors(fieldErrors);
        return;
      }
      console.error("Failed to save goal:", error);
      toast.error(goal ? t("updateError") : t("createError"));
    }
  };

  const titleError =
    errors.title &&
    (errors.title === "required"
      ? t("errors.titleRequired")
      : t("errors.titleTooLong", { max: GOAL_TITLE_MAX_LENGTH }));
  const descriptionError =
    errors.description &&
    t("errors.descriptionTooLong", { max: GOAL_DESCRIPTION_MAX_LENGTH });
  const targetError =
    errors.target &&
    (errors.target === "required"
      ? t("errors.targetRequired")
      : t("errors.targetInvalid"));
  const toError =
    errors.to &&
    (errors.to === "past" ? t("errors.toPast") : t("errors.toBeforeFrom"));
  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(" ") || undefined;

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className="grid gap-4"
    >
      <p className="text-muted-foreground text-xs">{t("requiredHint")}</p>

      <div className="space-y-2">
        <Label htmlFor={FIELD_ID.title}>
          {t("goalTitle")}
          <RequiredMark />
        </Label>
        <Input
          id={FIELD_ID.title}
          value={values.title}
          placeholder={t("goalTitlePlaceholder")}
          onChange={change("title")}
          maxLength={GOAL_TITLE_MAX_LENGTH}
          required
          aria-invalid={titleError ? true : undefined}
          aria-describedby={describedBy(titleError && errorId("title"))}
        />
        <FieldError id={errorId("title")} message={titleError} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={FIELD_ID.description}>{t("goalDescription")}</Label>
        <Textarea
          id={FIELD_ID.description}
          value={values.description}
          placeholder={t("goalDescriptionPlaceholder")}
          onChange={change("description")}
          maxLength={GOAL_DESCRIPTION_MAX_LENGTH}
          aria-invalid={descriptionError ? true : undefined}
          aria-describedby={describedBy(
            descriptionError && errorId("description"),
          )}
        />
        <FieldError id={errorId("description")} message={descriptionError} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={FIELD_ID.target}>
          {t("targetCompletions")}
          <RequiredMark />
        </Label>
        <Input
          id={FIELD_ID.target}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={values.target}
          onChange={change("target")}
          className="sm:max-w-40"
          required
          aria-invalid={targetError ? true : undefined}
          aria-describedby={describedBy(targetError && errorId("target"))}
        />
        <FieldError id={errorId("target")} message={targetError} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm leading-none font-medium">
          {t("period")}
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label
              htmlFor={FIELD_ID.from}
              className="text-muted-foreground font-normal"
            >
              {t("startDate")}
            </Label>
            <Input
              id={FIELD_ID.from}
              type="date"
              value={values.from}
              onChange={change("from")}
              aria-describedby="goal-period-hint"
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor={FIELD_ID.to}
              className="text-muted-foreground font-normal"
            >
              {t("endDate")}
            </Label>
            <Input
              id={FIELD_ID.to}
              type="date"
              value={values.to}
              min={minGoalEndDate(values, mode)}
              onChange={change("to")}
              aria-invalid={toError ? true : undefined}
              aria-describedby={describedBy(
                toError && errorId("to"),
                "goal-period-hint",
              )}
            />
            <FieldError id={errorId("to")} message={toError} />
          </div>
        </div>
        <p id="goal-period-hint" className="text-muted-foreground text-xs">
          {t("periodHint")}
        </p>
      </fieldset>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={pending}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {mode === "edit" ? t("save") : t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
