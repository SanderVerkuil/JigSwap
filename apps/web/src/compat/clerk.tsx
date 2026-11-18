// @clerk/nextjs compat: ported components import all Clerk things from "@/compat/clerk".

export {
  SignIn,
  SignUp,
  useAuth,
  useClerk,
  UserButton,
  useReverification,
  useUser,
} from "@clerk/tanstack-react-start";

// Reverification helpers live on the /errors subpath. `isReverificationCancelledError`
// distinguishes the user closing the step-up modal from a genuine failure.
export { isReverificationCancelledError } from "@clerk/tanstack-react-start/errors";
