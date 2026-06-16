import { Link } from "@/compat/link";
import { MarketingHeader } from "@/components/marketing/header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// The shared 404 card — chrome-free. TanStack renders a route's notFoundComponent
// inside that route's layout <Outlet />, so each context (marketing / app / admin)
// supplies its own shell around this; only the action row differs per context.
export function NotFoundContent({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("notFound");

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-4">
          <div className="bg-muted mx-auto flex h-24 w-24 items-center justify-center rounded-full">
            <TriangleAlert className="text-muted-foreground h-12 w-12" />
          </div>
          <CardTitle className="text-3xl font-bold">{t("title")}</CardTitle>
          <CardDescription className="text-lg">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{t("message")}</p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            {actions ?? (
              <>
                <Button asChild>
                  <Link href="/">{t("backToHome")}</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/browse">{t("browsePuzzles")}</Link>
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Marketing 404 — wraps the content in the marketing chrome itself. Used as the
// ROOT notFoundComponent (unmatched top-level paths), where no layout shell exists.
export function NotFound() {
  return (
    <div className="mk-root font-mk-sans bg-background min-h-screen">
      <MarketingHeader />
      <NotFoundContent />
    </div>
  );
}

// App 404 — rendered inside the dashboard shell (the _dashboard layout's Outlet),
// so it needs no chrome of its own; just app-appropriate actions.
export function AppNotFound() {
  const t = useTranslations("notFound");
  return (
    <NotFoundContent
      actions={
        <>
          <Button asChild>
            <Link href="/dashboard">{t("backToDashboard")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/browse">{t("browsePuzzles")}</Link>
          </Button>
        </>
      }
    />
  );
}

// Admin 404 — rendered inside the admin shell's Outlet.
export function AdminNotFound() {
  const t = useTranslations("notFound");
  return (
    <NotFoundContent
      actions={
        <Button asChild>
          <Link href="/admin">{t("backToAdmin")}</Link>
        </Button>
      }
    />
  );
}
