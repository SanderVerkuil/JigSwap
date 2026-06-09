import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { gateway } from "@jigswap/gateway";

// Proves the Clerk -> Convex auth handoff: an AUTHENTICATED per-member read through the shared
// gateway. Gated on the Clerk userId from root context so the signed-out case never queries.
export const Route = createFileRoute("/me")({ component: Me });

function Me() {
  const { userId } = useRouteContext({ from: "__root__" });
  const { data, isPending } = useQuery({
    ...convexQuery(gateway.identity.currentUser, {}),
    enabled: Boolean(userId),
  });

  if (!userId) {
    return (
      <main style={{ padding: "1rem" }}>
        <h1>Your profile</h1>
        <p>Sign in to load your member profile through the gateway.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "1rem" }}>
      <h1>Your profile</h1>
      {isPending ? (
        <p>Loading…</p>
      ) : data ? (
        <dl>
          <dt>Name</dt>
          <dd>{data.name}</dd>
          <dt>Email</dt>
          <dd>{data.email}</dd>
          {data.location ? (
            <>
              <dt>Location</dt>
              <dd>{data.location}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p>No member record yet.</p>
      )}
      <p>
        Read via <code>gateway.identity.currentUser</code> with the Clerk token.
      </p>
    </main>
  );
}
