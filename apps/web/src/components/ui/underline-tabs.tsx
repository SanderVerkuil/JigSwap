// Shared underline-style restyle of the boxed shadcn Tabs primitive: a transparent
// `TabsList` with a bottom border, and the active `TabsTrigger` gets a primary
// underline instead of the default boxed/shadowed look. `TabCount` is the small
// pill that follows a trigger's active state, for tabs that carry a live count.
// Used by the moderation console and the People page so both underline tab bars
// stay visually identical — extracted here rather than duplicated.

export const UNDERLINE_TABS_LIST_CLASS =
  "h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0";

export const TAB_TRIGGER_CLASS =
  "group -mb-px flex-none gap-2 rounded-none border-0 border-b-2 border-transparent px-4 py-2.5 font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent";

export function TabCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-bold text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
      {count}
    </span>
  );
}
