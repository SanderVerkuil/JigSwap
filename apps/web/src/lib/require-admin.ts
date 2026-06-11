import { auth } from "@clerk/tanstack-react-start/server";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

// Server-only: reads the Clerk session and reports whether the caller is an admin
// (publicMetadata.role === "admin" surfaced as sessionClaims.metadata.role). Runs
// in the admin route's beforeLoad so the role check happens before any chrome renders.
const fetchAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, sessionClaims } = await auth();
  return {
    userId,
    isAdmin: sessionClaims?.metadata?.role === "admin",
  };
});

// beforeLoad guard for the /admin routes: the Next layout did auth()+redirect, with
// a TODO for the role check. Here we require both an authenticated user (-> Clerk
// sign-in) and the admin role (-> home for non-admins).
export async function requireAdmin(opts: { location: { href: string } }) {
  const { userId, isAdmin } = await fetchAdminStatus();
  if (!userId) {
    throw redirect({
      to: "/sign-in/$",
      params: { _splat: "" },
      search: { redirect_url: opts.location.href },
    });
  }
  if (!isAdmin) {
    throw redirect({ to: "/" });
  }
  return { userId };
}
