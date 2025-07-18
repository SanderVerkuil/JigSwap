"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { ReactNode } from "react";

export function ClerkClientProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: undefined,
        variables: {
          colorPrimary: "#6366f1",
          colorBackground: "hsl(var(--background))",
          colorInputBackground: "hsl(var(--background))",
          colorInputText: "hsl(var(--foreground))",
          colorText: "hsl(var(--foreground))",
          colorTextSecondary: "hsl(var(--muted-foreground))",
          colorShimmer: "hsl(var(--muted))",
          colorNeutral: "hsl(var(--border))",
          colorDanger: "hsl(var(--destructive))",
          colorSuccess: "hsl(var(--jigsaw-success))",
          colorWarning: "hsl(var(--jigsaw-warning))",
          borderRadius: "0.5rem",
        },
        elements: {
          formButtonPrimary: {
            backgroundColor: "hsl(var(--jigsaw-primary))",
            "&:hover": {
              backgroundColor: "hsl(var(--jigsaw-primary) / 0.9)",
            },
          },
          card: {
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
          },
          headerTitle: {
            color: "hsl(var(--foreground))",
          },
          headerSubtitle: {
            color: "hsl(var(--muted-foreground))",
          },
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}