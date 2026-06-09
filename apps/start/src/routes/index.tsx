import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main style={{ padding: "1rem" }}>
      <h1>JigSwap on TanStack Start</h1>
      <p>
        Strangler-fig slice 1: this app runs alongside the Next.js app and
        reaches Convex through the shared <code>@jigswap/gateway</code>.
      </p>
      <p>
        <Link to="/insights">View platform insights →</Link>
      </p>
    </main>
  );
}
