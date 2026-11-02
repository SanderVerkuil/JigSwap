// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { SidebarProvider, SidebarRail, SidebarTrigger } from "./sidebar";

afterEach(cleanup);

// The shared primitives name their own controls through the app catalogue, so a Dutch member
// never hears "Close" or "Toggle Sidebar" (UX-64).
const catalogs = { en, nl } as const;
function inLocale(locale: keyof typeof catalogs) {
  return function LocaleWrapper({ children }: { children: ReactNode }) {
    return (
      <IntlProvider
        locale={locale}
        messages={catalogs[locale]}
        timeZone="Europe/Amsterdam"
      >
        {children}
      </IntlProvider>
    );
  };
}

describe.each(["en", "nl"] as const)("primitive labels in %s", (locale) => {
  const messages = catalogs[locale];

  it("names the dialog close button", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
      { wrapper: inLocale(locale) },
    );
    expect(
      screen.getByRole("button", { name: messages.common.close }),
    ).toBeTruthy();
  });

  // The 16px icon was the whole target: as the dialog's close, at least 36px, 44px on touch.
  it("gives the sheet close button a real target", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Body</SheetDescription>
        </SheetContent>
      </Sheet>,
      { wrapper: inLocale(locale) },
    );
    const close = screen.getByRole("button", { name: messages.common.close });
    expect(close.className).toContain("size-9");
    expect(close.className).toContain("pointer-coarse:size-11");
  });

  it("names the sheet close button", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Body</SheetDescription>
        </SheetContent>
      </Sheet>,
      { wrapper: inLocale(locale) },
    );
    expect(
      screen.getByRole("button", { name: messages.common.close }),
    ).toBeTruthy();
  });

  it("names the sidebar trigger and rail", () => {
    render(
      <SidebarProvider>
        <SidebarTrigger />
        <SidebarRail />
      </SidebarProvider>,
      { wrapper: inLocale(locale) },
    );
    expect(
      screen.getAllByRole("button", { name: messages.shell.toggleSidebar }),
    ).toHaveLength(2);
  });
});
