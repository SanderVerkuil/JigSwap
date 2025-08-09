import dynamic from "next/dynamic";
import { Suspense } from "react";
import { CallToAction } from "./_components/call-to-action";
import { ComingSoon } from "./_components/coming-soon";
import { CoreFeatures } from "./_components/core-features";
import { Footer } from "./_components/footer";
import { Header } from "./_components/header";
import { Hero } from "./_components/hero";
import { HomeActions } from "./_components/home-actions";
import { HowItWorks } from "./_components/how-it-works";

const HomeStats = dynamic(() =>
  import("./_components/home-stats").then((m) => m.HomeStats),
);

const HomeRecent = dynamic(() =>
  import("./_components/home-recent").then((m) => m.HomeRecent),
);

export default function HomePage() {
  return (
    <div className="bg-background">
      <Header />
      <Hero />
      <div className="[&>*:nth-child(odd)]:bg-muted/50">
        <HomeActions />
        <Suspense fallback={<section className="px-4 py-20" />}>
          <HomeStats />
        </Suspense>
        <Suspense fallback={<section className="px-4 py-20" />}>
          <HomeRecent />
        </Suspense>
        <CoreFeatures />
        <HowItWorks />
        <ComingSoon />
      </div>
      <CallToAction />
      <Footer />
    </div>
  );
}
