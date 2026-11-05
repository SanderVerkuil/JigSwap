"use client";

import {
  MOBILE_TAB_BAR_HEIGHT_VAR,
  MOBILE_TAB_BAR_RAISE,
  MOBILE_TOP_BAR_HEIGHT_VAR,
} from "@/components/dashboard-layout/sticky-offset";
import { useTheme } from "next-themes";
import { Toaster as Sonner, ToasterProps } from "sonner";

// Room the phone chrome takes at the viewport edges, from the heights the bars publish (both are
// 0px or unset where the bar isn't rendered: md and up, an open thread, public pages). At the
// bottom that is the tab bar plus its raised "+"; min() counts the raise only while the bar has
// a height, so without a bar toasts keep sonner's own gap.
const TAB_BAR = `var(${MOBILE_TAB_BAR_HEIGHT_VAR}, 0px)`;
const BOTTOM_CHROME = `${TAB_BAR} + min(${TAB_BAR}, ${MOBILE_TAB_BAR_RAISE})`;
const TOP_CHROME = `var(${MOBILE_TOP_BAR_HEIGHT_VAR}, 0px)`;

// sonner's gaps: 24px from the edges, 16px below 600px (its "mobile" layout). Between 600px and
// md the tab bar is still there, so both sets clear the chrome.
const OFFSET = {
  top: `calc(${TOP_CHROME} + 24px)`,
  bottom: `calc(${BOTTOM_CHROME} + 24px)`,
};
const MOBILE_OFFSET = {
  top: `calc(${TOP_CHROME} + 8px)`,
  bottom: `calc(${BOTTOM_CHROME} + 16px)`,
};

// sonner styles its buttons 24px tall at 12px; these are real targets (44px on touch).
const BUTTON = "!h-9 !px-3 !text-sm pointer-coarse:!h-11";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={OFFSET}
      mobileOffset={MOBILE_OFFSET}
      toastOptions={{
        classNames: { actionButton: BUTTON, cancelButton: BUTTON },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // sonner sets a system-ui stack on the list; toasts read in the app's font.
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
