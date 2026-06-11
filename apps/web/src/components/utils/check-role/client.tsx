"use client";

import { useUser } from "@/compat/clerk";
import { Roles } from "@/types/globals";

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
