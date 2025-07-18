interface MainContentProps {
  children: React.ReactNode;
}

export function MainContent({ children }: MainContentProps) {
  return <main className="flex-1 p-6 overflow-auto">{children}</main>;
}
