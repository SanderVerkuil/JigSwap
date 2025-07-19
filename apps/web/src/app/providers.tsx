import { ToastProvider } from "@/components/ui/toast";
import { ClerkClientProvider } from "@/lib/clerk-provider";
import { ConvexClientProvider } from "@/lib/convex-provider";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

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
            <ToastProvider>
              {children}
              <Toaster />
            </ToastProvider>
          </ConvexClientProvider>
        </ClerkClientProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
