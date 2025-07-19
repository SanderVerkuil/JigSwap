import { cn } from "@/lib/utils";

interface MainContentProps {
  children: React.ReactNode;
  className?: string;
}

export function MainContent({ children, className }: MainContentProps) {
  return (
    <main className={cn("flex-1 p-6 overflow-auto", className)}>
      {children}
    </main>
  );
}
