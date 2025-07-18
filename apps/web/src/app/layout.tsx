import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ClerkClientProvider } from '@/lib/clerk-provider';
import { ConvexClientProvider } from '@/lib/convex-provider';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ToastProvider } from '@/components/ui/toast';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: {
    default: 'JigSwap - Trade Jigsaw Puzzles',
    template: '%s | JigSwap',
  },
  description:
    'Connect with jigsaw puzzle enthusiasts and trade your completed puzzles. Reduce waste and make the hobby more accessible and sustainable.',
  keywords: [
    'jigsaw puzzles',
    'puzzle trading',
    'puzzle swap',
    'sustainable hobby',
    'puzzle community',
  ],
  authors: [{ name: 'JigSwap Team' }],
  creator: 'JigSwap',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://jigswap.com',
    title: 'JigSwap - Trade Jigsaw Puzzles',
    description:
      'Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.',
    siteName: 'JigSwap',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JigSwap - Trade Jigsaw Puzzles',
    description:
      'Connect with jigsaw puzzle enthusiasts and trade your completed puzzles.',
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
  // Providing all messages to the client side
  const messages = await getMessages();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ClerkClientProvider>
              <ConvexClientProvider>
                <ToastProvider>
                  <ErrorBoundary>{children}</ErrorBoundary>
                </ToastProvider>
              </ConvexClientProvider>
            </ClerkClientProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
