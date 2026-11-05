import { convexErrorCode } from "@/components/exchange/request-trade";

// The `cataloguePicker` key for a failed batch add. `RateLimited` is the daily copy budget
// (backend lib/rateLimits.ts copyAdd): the whole batch was refused, so the member waits rather than
// retries. Everything else is the generic "nothing was added" message.
export const addErrorKey = (error: unknown): "rateLimited" | "addFailed" =>
  convexErrorCode(error) === "RateLimited" ? "rateLimited" : "addFailed";
