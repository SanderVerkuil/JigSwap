import type { gateway } from "@/gateway";
import type { FunctionReturnType } from "convex/server";

// One of the member's goals as listMyGoals returns it (with the derived isAchieved).
export type GoalRow = FunctionReturnType<
  typeof gateway.solving.myGoals
>[number];
