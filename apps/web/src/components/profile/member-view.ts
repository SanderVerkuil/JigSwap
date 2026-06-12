import { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

// The acting member as returned by the identity gateway — the single shape the
// profile sections share so each component can scope its own reads off `_id`.
export type Member = NonNullable<
  FunctionReturnType<typeof gateway.identity.currentUser>
>;
