import { Badge } from "@/components/ui/badge";
import { useTranslations } from "use-intl";

// Small chips row showing which fields a change proposal touches, by label. Shared by every
// proposal row renderer — the admin queue, the admin per-definition history, and the
// member's own suggestions list.
export function ChangedFieldChips({
  changes,
}: {
  changes: Record<string, unknown>;
}) {
  const tf = useTranslations("forms.puzzle-form");

  const fieldLabel = (key: string): string => {
    switch (key) {
      case "barcodes":
        return `${tf("ean.label")} / ${tf("upc.label")} / ${tf("modelNumber.label")}`;
      case "image":
        return tf("image.label");
      default:
        return tf(`${key}.label`);
    }
  };

  const keys = Object.entries(changes)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

  if (keys.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => (
        <Badge key={key} variant="outline" className="text-xs">
          {fieldLabel(key)}
        </Badge>
      ))}
    </div>
  );
}
