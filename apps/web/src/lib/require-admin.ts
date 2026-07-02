import { gateway } from "@/gateway";
import { auth } from "@clerk/tanstack-react-start/server";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ConvexHttpClient } from "convex/browser";

// Server-only: resolves the caller's admin status from the BACKEND's identity
// context (gateway.identity.isAdmin -> convex identity/isCurrentUserAdmin), so
// the route guard and the server-side gates on every admin function share one
// source of truth. The Convex query reads the role from the Clerk "convex" JWT
// and fails closed: no session, no token, or a missing claim is NOT admin.
const fetchAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, getToken } = await auth();
  if (!userId) return { userId: null, isAdmin: false };
  const token = await getToken({ template: "convex" });
  if (!token) return { userId, isAdmin: false };
  const convex = new ConvexHttpClient(
    import.meta.env.VITE_CONVEX_URL as string,
  );
  convex.setAuth(token);
  return { userId, isAdmin: await convex.query(gateway.identity.isAdmin, {}) };
});

// beforeLoad guard for the /admin routes: require both an authenticated user
// (-> Clerk sign-in) and the backend-confirmed admin role (-> home for
// non-admins). Cosmetic only — every admin Convex function re-checks isAdmin
// server-side regardless of how the route was reached.
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
