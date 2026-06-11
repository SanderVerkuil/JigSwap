import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

// Clerk requires its middleware on every request so auth() in server fns
// (see __root.tsx fetchClerkAuth) can read the session from the context.
export const startInstance = createStart(() => ({
  requestMiddleware: [clerkMiddleware()],
}));
