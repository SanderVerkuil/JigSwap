import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { Container } from "@/components/marketing/container";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { Eyebrow } from "@/components/marketing/section";
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

// The in-app 404 card — chrome-free. TanStack renders a route's notFoundComponent
// inside that route's layout <Outlet />, so the app shell supplies the chrome;
// the public site uses MarketingNotFound below instead.
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

const inlineLink = "text-mk-violet-600 font-medium hover:underline";

// The public 404 in the marketing look: a 404 kicker, an h1, one line of explanation and ways
// back into the public site (home, catalogue, docs, contact) — never members-only pages, which
// would bounce a visitor to sign-in. It renders no landmark itself so it also fits a layout that
// already provides <main> (the docs). A route may name what's missing via `title`/`message`, and
// drop the 404 kicker when the page isn't one (a failed read).
export function MarketingNotFoundContent({
  kicker = "404",
  title,
  message,
}: {
  kicker?: string | null;
  title?: string;
  message?: string;
}) {
  const t = useTranslations("notFound");
  return (
    <Container className="py-[clamp(56px,9vw,112px)] text-center">
      {kicker && <Eyebrow center>{kicker}</Eyebrow>}
      <h1 className="font-mk-heading font-bold tracking-tight text-mk-text-strong text-[clamp(32px,5vw,48px)] leading-[1.1] mt-4 text-balance">
        {title ?? t("title")}
      </h1>
      <p className="mt-4 mx-auto max-w-[540px] text-[17px] leading-relaxed text-mk-text-muted text-pretty">
        {message ?? t("message")}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button variant="brand" className="h-11 px-6 text-[15px]" asChild>
          <Link href="/">{t("backToHome")}</Link>
        </Button>
        <Button
          variant="outline"
          className="h-11 px-6 text-[15px] bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
          asChild
        >
          <Link href="/catalog">{t("browseCatalogue")}</Link>
        </Button>
      </div>
      <p className="mt-6 text-[15px] text-mk-text-muted">
        {t.rich("helpLinks", {
          docs: (chunks) => (
            <Link href="/docs" className={inlineLink}>
              {chunks}
            </Link>
          ),
          contact: (chunks) => (
            <Link href="/contact" className={inlineLink}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    </Container>
  );
}

// The public 404 as a page body: used inside the marketing layout's Outlet (_public).
export function MarketingNotFound() {
  return (
    <main id={MAIN_CONTENT_ID}>
      <MarketingNotFoundContent />
    </main>
  );
}

// ROOT notFoundComponent (unmatched top-level paths), where no layout shell exists: the public
// 404 framed in the marketing header and footer.
export function NotFound() {
  return (
    <div className="mk-root font-mk-sans min-h-screen flex flex-col overflow-x-clip">
      <MarketingHeader />
      <div className="flex-1">
        <MarketingNotFound />
      </div>
      <MarketingFooter />
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
