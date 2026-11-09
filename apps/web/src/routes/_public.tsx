import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingNotFound } from "@/components/NotFound";
import { PageLoading } from "@/components/ui/loading";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// Pathless layout for the (public) marketing pages (about/contact/privacy/terms/
// how-it-works/features). Marketing chrome (sticky header + curtain footer);
// children keep their top-level URLs (/about, /contact, ...) and lay out their
// own full-width sections.
export const Route = createFileRoute("/_public")({
  pendingComponent: PublicPending,
  // 404 under a marketing route renders within this marketing shell (its Outlet).
  notFoundComponent: MarketingNotFound,
  component: PublicLayout,
});

function PublicPending() {
  const t = useTranslations("common");
  return <PageLoading message={t("loading")} />;
}

// The pages whose hero carries the bar's own action, in marigold.
const HERO_ACTION_PAGES = new Set(["/features", "/how-it-works"]);

function PublicLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="mk-root font-mk-sans min-h-svh flex flex-col overflow-x-clip">
      <MarketingHeader hideActionNearHero={HERO_ACTION_PAGES.has(pathname)} />
      <div className="relative z-10 min-h-svh flex-1 bg-mk-bg">
        <Outlet />
      </div>
      <MarketingFooter curtain />
    </div>
  );
}
