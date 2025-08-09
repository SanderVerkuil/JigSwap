import { useTranslations } from "next-intl";

interface PuzzleFormTitleProps {
  children?: React.ReactNode;
}

export const PuzzleFormTitle = ({ children }: PuzzleFormTitleProps) => {
  const t = useTranslations("forms.puzzle-form");

  return (
    <h2 className="text-lg font-semibold">{children || t("formTitle")}</h2>
  );
};
