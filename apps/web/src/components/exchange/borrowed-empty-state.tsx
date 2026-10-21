import { Link } from "@/compat/link";
import { EmptyState } from "@/components/library/empty-state";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useTranslations } from "use-intl";

// No open loans: how borrowing works and where to find a puzzle to borrow.
// Shared by /borrowed and the Borrowed tab on Exchanges.
export function BorrowedEmptyState() {
  const t = useTranslations("lending");
  return (
    <EmptyState
      title={t("noBorrowed")}
      sub={t("noBorrowedDescription")}
      action={
        <Button asChild variant="brand">
          <Link href="/browse">
            <Search className="h-4 w-4" />
            {t("browseAction")}
          </Link>
        </Button>
      }
    />
  );
}
