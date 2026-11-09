import { Input } from "@/components/ui/input";
import { barcodeFieldOk } from "@/lib/barcode-check";
import { useState, type ComponentProps } from "react";
import { useTranslations } from "use-intl";

// An EAN or UPC field that checks the code once the member leaves it, by the catalogue's own rules
// (lib/barcode-check): a code the server would refuse marks the field invalid and says why right
// under it, instead of a toast after submitting. `reveal` shows that without waiting for a blur (a
// submit the form held back). The caller renders the label, as for any other field.
export function BarcodeInput({
  kind,
  id,
  value,
  reveal = false,
  onBlur,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "id" | "value"> & {
  kind: "ean" | "upc";
  id: string;
  value: string;
  reveal?: boolean;
}) {
  const tf = useTranslations("forms.puzzle-form");
  const [left, setLeft] = useState(false);
  const invalid = (left || reveal) && !barcodeFieldOk(kind, value);
  const errorId = `${id}-error`;
  return (
    <>
      <Input
        {...inputProps}
        id={id}
        value={value}
        onBlur={(event) => {
          setLeft(true);
          onBlur?.(event);
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      {invalid && (
        <p id={errorId} className="text-destructive text-sm">
          {tf(`${kind}.invalid`)}
        </p>
      )}
    </>
  );
}
