"use client";

// Console-style inset shell (Google-Cloud-Console pattern): the tinted chrome
// surface fills the viewport and carries the global top bar and the
// transparent sidebar; the page content floats on it as a rounded, bordered,
// soft-shadowed card with the page head fixed at its top and the content
// scrolling inside it.

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { PageHead } from "./page-head";
import { ShellPreferencesProvider, useShellPreferences } from "./preferences";
import { TopBar } from "./top-bar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <ShellPreferencesProvider>
      <SidebarProvider className="h-svh flex-col overflow-hidden">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <div className="flex min-h-0 flex-1">
          <AppSidebar />
          <SidebarInset className="min-h-0 overflow-hidden md:peer-data-[variant=inset]:mt-0 md:peer-data-[variant=inset]:mr-3 md:peer-data-[variant=inset]:mb-3 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-0">
            <PageHead />
            <ContentArea>{children}</ContentArea>
          </SidebarInset>
        </div>
        <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} />
      </SidebarProvider>
    </ShellPreferencesProvider>
  );
}

// The scrollable inside of the content card; honours the content-width
// preference (full width by default, or a ~1180px centered column).
function ContentArea({ children }: { children: React.ReactNode }) {
  const { fullWidth } = useShellPreferences();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "w-full p-4 md:p-6",
          !fullWidth && "mx-auto max-w-[1180px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
