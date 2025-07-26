import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Compressor from "compressorjs";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FieldValues } from "react-hook-form";

interface FileUploadProps extends FieldValues {
  placeholder: string;
}

export function FileUpload({
  value,
  field,
  placeholder,
  onChange,
}: FileUploadProps) {
  const t = useTranslations("forms.file-upload");
  const [isCompressing, setIsCompressing] = useState(false);
  const [hasError, setHasError] = useState(false);
  if (isCompressing) {
    return <div>{t("compressing")}</div>;
  }
  if (!value) {
    return (
      <>
        <Input
          {...field}
          placeholder={placeholder}
          type="file"
          accept="image/*"
          onChange={(e) => {
            setHasError(false);
            setIsCompressing(true);
            e.preventDefault();
            const file = e.target.files?.[0];
            if (!file) return;

            new Compressor(file, {
              quality: 0.6,
              success: (result) => {
                setIsCompressing(false);
                onChange(new File([result], file.name, { type: file.type }));
              },
              error: (error) => {
                setIsCompressing(false);
                setHasError(true);
                console.error(error);
              },
            });
          }}
        />
        {hasError && <p className="text-destructive text-sm">{t("error")}</p>}
      </>
    );
  }
  return (
    <div className="relative flex flex-col items-center gap-2">
      <img
        src={URL.createObjectURL(value as unknown as Blob)}
        alt="Puzzle Image"
        className="w-full object-contain"
      />
      <div className="absolute top-0 right-0 p-4">
        <Button
          type="button"
          role="button"
          variant="destructive"
          size="icon"
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
