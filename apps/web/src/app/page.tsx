'use client';

import { Header } from './_components/header';
import { Hero } from './_components/hero';
import { CoreFeatures } from './_components/core-features';
import { DetailedFeatures } from './_components/detailed-features';
import { HowItWorks } from './_components/how-it-works';
import { CallToAction } from './_components/call-to-action';
import { Footer } from './_components/footer';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <Hero />
      <CoreFeatures />
      <DetailedFeatures />
      <HowItWorks />
      <CallToAction />
      <Footer />
    </div>
  );
}
