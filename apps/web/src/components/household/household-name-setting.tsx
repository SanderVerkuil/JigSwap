import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gateway } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// The longest name the server accepts (MAX_HOUSEHOLD_NAME_LENGTH, counted after normalising).
const MAX_NAME_LENGTH = 100;

// The household's own name, in the settings card. The admin edits it (an empty field clears it);
// members see it read-only. Only members of the household ever see the name: the server returns
// it from household.mine alone. Mount with `key={name}` so a saved name resets the field.
export function HouseholdNameSetting({
  isAdmin,
  name,
  onError,
}: {
  isAdmin: boolean;
  name: string | undefined;
  onError: (error: unknown) => void;
}) {
  const t = useTranslations("household.settings");
  const inputId = useId();
  const [draft, setDraft] = useState(name ?? "");

  const rename = useMutation({
    mutationFn: useConvexMutation(gateway.household.rename),
    onSuccess: () => toast.success(t("nameSaved")),
    onError,
  });

  const trimmed = draft.trim();
  const unchanged = trimmed === (name ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged || rename.isPending) return;
    rename.mutate({ name: trimmed === "" ? null : trimmed });
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{t("nameLabel")}</span>
        <span className={name ? "text-sm" : "text-muted-foreground text-sm"}>
          {name ?? t("nameNone")}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {t("nameLabel")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          placeholder={t("namePlaceholder")}
          onChange={(event) => setDraft(event.target.value)}
          className="max-w-sm min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          className="pointer-coarse:min-h-11"
          disabled={unchanged || rename.isPending}
        >
          {t("nameSave")}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t("nameHelp")}</p>
    </form>
  );
}
