import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingNotFound } from "@/components/NotFound";
import { PageLoading } from "@/components/ui/loading";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

// Pathless layout for the (public) marketing pages (about/contact/privacy/terms/
// how-it-works/features). Marketing chrome (sticky header + curtain footer);
// children keep their top-level URLs (/about, /contact, ...) and lay out their
// own full-width sections. The content is opaque and stacked above the footer,
// so it slides up to uncover it.
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

function PublicLayout() {
  return (
    <div className="mk-root font-mk-sans min-h-svh flex flex-col overflow-x-clip">
      <MarketingHeader />
      <div className="relative z-10 min-h-svh flex-1 bg-mk-bg">
        <Outlet />
      </div>
      <MarketingFooter curtain />
    </div>
  );
}
