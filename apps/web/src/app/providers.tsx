import CookieConsent from "@/components/blocks/cookie-consent";
import { ClerkClientProvider } from "@/lib/clerk-provider";
import { ConvexClientProvider } from "@/lib/convex-provider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";

export async function Providers({ children }: { children: React.ReactNode }) {
  // Providing all messages to the client side
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ClerkClientProvider>
          <ConvexClientProvider>
            {children}
            <CookieConsent variant="mini" />
          </ConvexClientProvider>
        </ClerkClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
