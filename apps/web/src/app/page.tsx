"use client";

import { useTranslations } from "next-intl";
import { CallToAction } from "./_components/call-to-action";
import { ComingSoon } from "./_components/coming-soon";
import { CoreFeatures } from "./_components/core-features";
import { Footer } from "./_components/footer";
import { Header } from "./_components/header";
import { Hero } from "./_components/hero";
import { HomeActions } from "./_components/home-actions";
import { HomeRecent } from "./_components/home-recent";
import { HomeStats } from "./_components/home-stats";
import { HowItWorks } from "./_components/how-it-works";

export default function HomePage() {
  useTranslations();

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
