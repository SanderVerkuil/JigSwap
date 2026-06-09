import { createFileRoute } from "@tanstack/react-router";

import { CallToAction } from "@/components/landing/call-to-action";
import { ComingSoon } from "@/components/landing/coming-soon";
import { CoreFeatures } from "@/components/landing/core-features";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { HomeActions } from "@/components/landing/home-actions";
import { HomeRecent } from "@/components/landing/home-recent";
import { HomeStats } from "@/components/landing/home-stats";
import { HowItWorks } from "@/components/landing/how-it-works";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "JigSwap" }],
  }),
  component: Home,
});

// Next used next/dynamic + Suspense to defer HomeStats/HomeRecent out of the SSR
// bundle. Start has no RSC and both are "use client" islands gated on client-side
// useQuery, so they render directly here.
function Home() {
  return (
    <div className="bg-background">
      <Header />
      <Hero />
      <div className="[&>*:nth-child(odd)]:bg-muted/50">
        <HomeActions />
        <HomeStats />
        <HomeRecent />
        <CoreFeatures />
        <HowItWorks />
        <ComingSoon />
      </div>
      <CallToAction />
      <Footer />
    </div>
  );
}
