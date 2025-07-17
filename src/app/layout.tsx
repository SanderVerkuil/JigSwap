import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ClerkClientProvider } from "@/lib/clerk-provider";
import { ConvexClientProvider } from "@/lib/convex-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "JigSwap - Trade Jigsaw Puzzles",
    template: "%s | JigSwap"
  },
  description: "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles. Reduce waste and make the hobby more accessible and sustainable.",
  keywords: ["jigsaw puzzles", "puzzle trading", "puzzle swap", "sustainable hobby", "puzzle community"],
  authors: [{ name: "JigSwap Team" }],
  creator: "JigSwap",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://jigswap.com",
    title: "JigSwap - Trade Jigsaw Puzzles",
    description: "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.",
    siteName: "JigSwap",
  },
  twitter: {
    card: "summary_large_image",
    title: "JigSwap - Trade Jigsaw Puzzles",
    description: "Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ClerkClientProvider>
          <ConvexClientProvider>
            <ThemeProvider
              defaultTheme="system"
              storageKey="jigswap-ui-theme"
            >
              {children}
            </ThemeProvider>
          </ConvexClientProvider>
        </ClerkClientProvider>
      </body>
    </html>
  );
}
