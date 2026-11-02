"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  StickyTabsBar,
  TAB_TRIGGER_CLASS,
  TabCount,
  UNDERLINE_TABS_LIST_CLASS,
} from "@/components/ui/underline-tabs";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";
import type { ModerationTab } from "./moderation-search";

export interface ModerationTabEntry {
  value: ModerationTab;
  label: string;
  count?: number;
  capped?: boolean;
}

// The console's tab bar. Every tab and its count stays in view, because a count that scrolled out
// of sight is a queue nobody works: from md the tabs wrap onto a second row where they don't fit
// one, and below md, where seven don't fit two rows, they are one dropdown listing them all with
// their counts. Tighter than the shared tabs, without icons, so they fit one row at 1440. What
// sticks below the bar reads its height from --moderation-tabs-height, set on the Tabs root.
export function ModerationTabBar({
  tabs,
  value,
  onValueChange,
}: {
  tabs: ModerationTabEntry[];
  value: ModerationTab;
  onValueChange: (value: string) => void;
}) {
  const t = useTranslations("admin.moderation.tabs");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      bar.parentElement?.style.setProperty(
        "--moderation-tabs-height",
        `${bar.offsetHeight}px`,
      );
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <StickyTabsBar ref={barRef}>
      <div className="py-2 md:hidden">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger aria-label={t("label")} className="h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((tab) => (
              <SelectItem
                key={tab.value}
                value={tab.value}
                className="pointer-coarse:min-h-11"
              >
                {tab.label}
                <TabCount count={tab.count} capped={tab.capped} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TabsList
        className={cn(
          UNDERLINE_TABS_LIST_CLASS,
          "max-md:hidden md:flex-wrap md:overflow-visible",
        )}
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className={cn(TAB_TRIGGER_CLASS, "px-3")}
          >
            {tab.label}
            <TabCount count={tab.count} capped={tab.capped} />
          </TabsTrigger>
        ))}
      </TabsList>
    </StickyTabsBar>
  );
}
