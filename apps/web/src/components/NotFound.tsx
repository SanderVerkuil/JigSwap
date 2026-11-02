import { Link } from "@/compat/link";
import { MarketingHeader } from "@/components/marketing/header";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// The shared 404 — chrome-free. TanStack renders a route's notFoundComponent inside that route's
// layout <Outlet />, so each context (marketing / app) supplies its own shell around this; only the
// action row differs per context.
export function NotFoundContent({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("notFound");

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-[1200px] flex-col justify-center px-6 py-16">
      <h1 className="font-heading text-foreground max-w-[20ch] text-[clamp(33px,4.6vw,68px)] leading-[1.06] font-normal tracking-[-0.015em] text-balance">
        {t("title")}
      </h1>
      <p className="text-foreground mt-5 max-w-[52ch] text-[clamp(18px,1.5vw,21px)] leading-normal text-pretty">
        {t("description")}
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        {actions ?? (
          <>
            <Button variant="brand" className="h-11 px-6 text-[16px]" asChild>
              <Link href="/">{t("backToHome")}</Link>
            </Button>
            <Button
              variant="link"
              className="h-11 px-2 text-[16px] underline underline-offset-3"
              asChild
            >
              <Link href="/browse">{t("browsePuzzles")}</Link>
            </Button>
          </>
        )}
      </div>
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
// so it needs no chrome of its own; just app-appropriate actions. Covers the
// /admin subtree too, which lives inside the same shell.
export function AppNotFound() {
  const t = useTranslations("notFound");
  return (
    <NotFoundContent
      actions={
        <>
          <Button className="h-11 px-6 text-[16px]" asChild>
            <Link href="/dashboard">{t("backToDashboard")}</Link>
          </Button>
          <Button
            variant="link"
            className="h-11 px-2 text-[16px] underline underline-offset-3"
            asChild
          >
            <Link href="/browse">{t("browsePuzzles")}</Link>
          </Button>
        </>
      }
    />
  );
}
