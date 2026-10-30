import { nlNL } from "@clerk/localizations";

// Clerk's stock nl-NL with the strings it gets wrong corrected. The
// restricted sign-up card (shown when sign-ups are closed or waitlist-only)
// ships garbled ("We wachten op je toegang tot de wachtlijst") and relabels its
// sign-in link as a support link ("Hulp nodig? Neem contact op met de
// ondersteuning") although it still goes to sign-in. Wording follows the app's
// own Dutch: "Registreren" for sign-up, "Inloggen" for sign-in, informal "je".
// The "join the waitlist" button leaves the app for Clerk's hosted Account
// Portal, which is localised in the Clerk dashboard, not here.
export const nlNLLocalization: typeof nlNL = {
  ...nlNL,
  signUp: {
    ...nlNL.signUp,
    restrictedAccess: {
      ...nlNL.signUp?.restrictedAccess,
      title: "Registratie gesloten",
      subtitle:
        "Je kunt op dit moment geen account aanmaken. Denk je dat je wel toegang zou moeten hebben? Neem dan contact met ons op.",
      subtitleWaitlist:
        "Je kunt op dit moment geen account aanmaken. Zet je op de wachtlijst, dan hoor je het als eerste zodra het kan.",
      actionText: "Heb je al een account?",
      actionLink: "Inloggen",
      blockButton__emailSupport: "Stuur ons een e-mail",
    },
  },
};
