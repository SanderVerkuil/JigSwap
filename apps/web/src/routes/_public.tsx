import { Outlet, createFileRoute } from "@tanstack/react-router";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PageLoading } from "@/components/ui/loading";

// Pathless layout for the (public) marketing pages (about/contact/privacy/terms).
// Mirrors app/(public)/layout.tsx — public chrome (Header + Footer) wrapping the
// page content; children keep their top-level URLs (/about, /contact, ...).
export const Route = createFileRoute("/_public")({
  pendingComponent: () => <PageLoading message="Loading..." />,
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="bg-background pt-[57px]">
      <Header />
      <div className="container mx-auto p-6">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
