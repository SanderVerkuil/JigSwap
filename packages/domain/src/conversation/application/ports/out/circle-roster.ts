import { CircleId, CircleParticipant } from "../../../domain";

// Outbound port: a circle's current members, each with the instant they joined the circle (their
// history floor in its thread). null means there is no such circle. The Convex adapter reads
// Sharing's circle membership; Conversation never loads the Circle aggregate itself.
export interface CircleRoster {
  membersOf(circleId: CircleId): Promise<readonly CircleParticipant[] | null>;
}
