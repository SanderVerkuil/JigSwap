import { Circle, CircleId, MemberId } from "../../../domain";

// Outbound port: persistence for the Circle aggregate (root + its memberships, saved as one unit).
// The backend adapter implements this over `ctx.db` behind a mapper; the domain never sees a row.
export interface CircleRepository {
  findById(id: CircleId): Promise<Circle | null>;
  // Every circle the member belongs to. Backs the VisibilityPolicy wiring: intersecting a viewer's
  // and an owner's circles yields the `sharedCircles` facts the policy needs.
  listForMember(memberId: MemberId): Promise<readonly Circle[]>;
  save(circle: Circle): Promise<void>;
}
