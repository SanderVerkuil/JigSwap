"use server";

import { Roles } from "@/types/globals";
import { auth } from "@clerk/nextjs/server";

export async function CheckRole({
  role,
  children,
}: {
  role: Roles;
  children: React.ReactNode;
}) {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata?.role === role ? children : null;
}
