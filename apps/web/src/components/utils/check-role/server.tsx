"use client";

import { useUser } from "@/compat/clerk";
import { Roles } from "@/types/globals";

// RSC->client adaptation: the Next source was a server component using `auth()` server-side.
// TanStack Start has no RSC, so this mirrors `client.tsx`, gating on the Clerk session's
// publicMetadata role on the client; the role-gating behaviour is preserved.
export function CheckRole({
  role,
  children,
}: {
  role: Roles;
  children: React.ReactNode;
}) {
  const { user } = useUser();
  return user?.publicMetadata.role === role ? children : null;
}
