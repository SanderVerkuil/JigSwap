import { convexErrorCode } from "@/components/exchange/request-trade";

// The copyInstance message for a refused change to a copy. The Library refuses a sharing change
// while an exchange in progress reserves the copy or it is out on loan, and after too many sharing
// changes in a minute (backend lib/rateLimits copySharing); both say so rather than "please try
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
