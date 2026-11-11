import { Link } from "@/compat/link";
import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import {
  isFullBleedRoute,
  isImmersiveMobileRoute,
} from "@/components/dashboard-layout/route-meta";
import { Container } from "@/components/marketing/container";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocation, type NotFoundRouteProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

// The router's default 404 (router.tsx), chrome-free with its own display headline: TanStack drops
// it into the Outlet of the layout it falls under. The app shell has its own (AppNotFound below,
// titled in the page head) and the public site MarketingNotFound.
export function NotFoundContent() {
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
      </div>
    </div>
  );
}

const inlineLink = "font-medium underline underline-offset-4";

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
      {kicker && <p className="text-[17px] text-mk-text-muted">{kicker}</p>}
      <h1 className="font-mk-heading font-normal text-mk-text-strong text-[clamp(32px,5vw,48px)] leading-[1.1] mt-4 text-balance">
        {title ?? t("title")}
      </h1>
      <p className="mt-4 mx-auto max-w-[540px] text-[17px] leading-relaxed text-mk-text-muted text-pretty">
        {message ?? t("message")}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button variant="brand" size="public" asChild>
          <Link href="/">{t("backToHome")}</Link>
        </Button>
        <Button
          variant="outline"
          size="public"
          className="bg-mk-card border-mk-border text-mk-text-strong hover:bg-mk-muted"
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

// A not-found inside the app shell. Its title goes to the page head, which already holds the
// page's h1 (and ShellHeading's below md), so the body is only a line of explanation and the ways
// back, at the app's body size and on the content's own edge. `publish` puts the title in the head
// (with no breadcrumb). The page head is one slot and a parent's publish runs after, and overwrites,
// its child's: a page that publishes its own header passes `publish={false}` and returns
// `{ title, crumbs: [] }` (with no actions) from its own usePageHeader while it shows this.
// On a phone an open thread's path (/messages/<id>) hides the top bar, so there the title shows
// here, as the page's h1 below md.
export function ShellNotFound({
  title,
  description,
  backHref,
  backLabel,
  actions,
  publish = true,
}: {
  title: string;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  publish?: boolean;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const phoneHeading = publish && isImmersiveMobileRoute(pathname);
  const actionRow =
    actions ??
    (backHref && backLabel ? (
      <Button variant="outline" asChild>
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    ) : null);
  return (
    // A full-bleed page (/messages) drops the shell's content padding, so this pads itself there.
    <div
      data-slot="shell-not-found"
      className={cn(
        "flex flex-col items-start gap-4",
        isFullBleedRoute(pathname) && "md:p-6",
      )}
    >
      {publish && (
        <PublishNotFoundTitle title={title} phoneHeading={phoneHeading} />
      )}
      {phoneHeading && (
        <h1 className="font-heading -mb-2 text-2xl md:hidden">{title}</h1>
      )}
      {description && (
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {description}
        </p>
      )}
      {actionRow && (
        <div className="flex flex-wrap items-center gap-3">{actionRow}</div>
      )}
    </div>
  );
}

// Its own component so ShellNotFound publishes only when asked: a publish that isn't wanted would
// still clear the host's header when it unmounts. With `phoneHeading` the body shows the h1 below
// md, so ShellHeading steps aside there; the head keeps its h1 from md.
function PublishNotFoundTitle({
  title,
  phoneHeading,
}: {
  title: string;
  phoneHeading: boolean;
}) {
  usePageHeader(
    () => ({
      title,
      crumbs: [],
      ownsHeading: phoneHeading ? "phone" : undefined,
    }),
    [title, phoneHeading],
  );
  return null;
}

// The shell's 404: unknown paths under the _dashboard layout (its notFoundComponent, which covers
// /admin too and gets the router's not-found props) and the circle and thread pages that turn a
// refused read into one.
export function AppNotFound({
  publish,
}: { publish?: boolean } & Partial<NotFoundRouteProps>) {
  const t = useTranslations("notFound");
  return (
    <ShellNotFound
      publish={publish}
      title={t("title")}
      description={t("description")}
      actions={
        <>
          <Button asChild>
            <Link href="/dashboard">{t("backToDashboard")}</Link>
          </Button>
          <Button
            variant="link"
            className="px-2 underline underline-offset-3"
            asChild
          >
            <Link href="/browse">{t("browsePuzzles")}</Link>
          </Button>
        </>
      }
    />
  );
}
