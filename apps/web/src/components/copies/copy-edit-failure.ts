import { convexErrorCode } from "@/components/exchange/request-trade";

// The copyInstance message for a refused change to a copy. The Library refuses a sharing change
// while an exchange in progress reserves the copy or it is out on loan, and any change after too many
// in a minute (backend lib/rateLimits copySharing, copyEdit); both say so rather than "please try
// again".
export const copyEditFailureKey = (
  error: unknown,
): "editCopy.copyReserved" | "editCopy.rateLimited" | "editCopy.editFailed" => {
  switch (convexErrorCode(error)) {
    case "CopyReserved":
      return "editCopy.copyReserved";
    case "RateLimited":
      return "editCopy.rateLimited";
    default:
      return "editCopy.editFailed";
  }
};
