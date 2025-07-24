import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Baloo_2, Poppins } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const baloo2 = Baloo_2({
  subsets: ["latin"],
  variable: "--font-heading",
  preload: false,
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "JigSwap - Trade Jigsaw Puzzles",
    template: "%s | JigSwap",
  },
  description:
    "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles. Reduce waste and make the hobby more accessible and sustainable.",
  keywords: [
    "jigsaw puzzles",
    "puzzle trading",
    "puzzle swap",
    "sustainable hobby",
    "puzzle community",
  ],
  authors: [{ name: "JigSwap Team" }],
  creator: "JigSwap",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://jigswap.site",
    title: "JigSwap - Trade Jigsaw Puzzles",
    description:
      "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.",
    siteName: "JigSwap",
  },
  twitter: {
    card: "summary_large_image",
    title: "JigSwap - Trade Jigsaw Puzzles",
    description:
      "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${baloo2.variable} ${poppins.variable} font-sans antialiased`}
      >
        <Providers>
          <ErrorBoundary>{children}</ErrorBoundary>
        </Providers>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
