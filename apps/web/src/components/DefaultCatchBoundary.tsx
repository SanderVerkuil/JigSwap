import type { ErrorComponentProps } from "@tanstack/react-router";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  return (
    <div style={{ padding: "1rem" }}>
      <h1>Something went wrong</h1>
      <pre style={{ whiteSpace: "pre-wrap" }}>{error.message}</pre>
    </div>
  );
}
