import { solvingSettingsSection } from "../solving/adapters/solvingSettingsProvider";
import type { MemberSettingsSection } from "./memberSettingsSection";

// Every context that owns member settings registers its section here. The read endpoint iterates
// this list — adding a future setting means adding one context provider, no endpoint change.
export const memberSettingsSections: MemberSettingsSection[] = [
  solvingSettingsSection,
];
