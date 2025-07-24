import { useTranslations } from "next-intl";

interface PuzzleProductFormTitleProps {
  children?: React.ReactNode;
}

export const PuzzleProductFormTitle = ({
  children,
}: PuzzleProductFormTitleProps) => {
  const t = useTranslations("forms.puzzle-product-form");

  return <h2 className="text-lg font-semibold">{children || t("title")}</h2>;
};
