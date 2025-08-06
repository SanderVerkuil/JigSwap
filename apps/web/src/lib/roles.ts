import { Roles } from "@/types/globals";
import { auth } from "@clerk/nextjs/server";

export const checkRole = async (role: Roles) => {
  const { sessionClaims } = await auth();

  if (!sessionClaims) {
    return false;
  }

  return sessionClaims.metadata?.role === role;
};
