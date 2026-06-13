// apps/web/src/components/add-puzzle/section-divider.tsx
export const SectionDivider = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3.5">
    <span className="h-px flex-1 bg-border" />
    <span className="text-xs uppercase tracking-[0.06em] whitespace-nowrap text-muted-foreground">
      {label}
    </span>
    <span className="h-px flex-1 bg-border" />
  </div>
);
