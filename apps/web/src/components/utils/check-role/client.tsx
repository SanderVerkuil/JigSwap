"use client";

import { Roles } from "@/types/globals";
import { useUser } from "@clerk/nextjs";

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
