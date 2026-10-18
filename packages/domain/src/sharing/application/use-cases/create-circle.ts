import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Circle } from "../../domain";
import {
  CreateCircle,
  CreateCircleCommand,
} from "../ports/in/create-circle.port";
import { CircleRepository } from "../ports/out/circle.repository";
import {
  CircleIdGenerator,
  MembershipIdGenerator,
} from "../ports/out/id-generators";

export interface CreateCircleDeps {
  readonly circles: CircleRepository;
  readonly circleIds: CircleIdGenerator;
  readonly membershipIds: MembershipIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a Circle (owner seeded as Admin member), persist, publish CircleCreated.
// Only the domain's name rule can refuse it (InvalidCircleName); nothing is saved then.
export const makeCreateCircle =
  (deps: CreateCircleDeps): CreateCircle =>
  async (cmd: CreateCircleCommand) => {
    const created = Circle.create({
      id: deps.circleIds.next(),
      ownerId: cmd.ownerId,
      ownerMembershipId: deps.membershipIds.next(),
      name: cmd.name,
      now: deps.clock.now(),
    });
    if (created.isErr) return err(created.error);
    const circle = created.value;

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(circle.id);
  };
