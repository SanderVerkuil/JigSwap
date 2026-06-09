import { Clock, DomainEventPublisher, ok } from "../../../shared-kernel";
import { Circle } from "../../domain";
import { CreateCircle, CreateCircleCommand } from "../ports/in/create-circle.port";
import { CircleIdGenerator, MembershipIdGenerator } from "../ports/out/id-generators";
import { CircleRepository } from "../ports/out/circle.repository";

export interface CreateCircleDeps {
  readonly circles: CircleRepository;
  readonly circleIds: CircleIdGenerator;
  readonly membershipIds: MembershipIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a Circle (owner seeded as Admin member), persist, publish CircleCreated.
// Creation enforces no app-level rule, so it cannot fail.
export const makeCreateCircle =
  (deps: CreateCircleDeps): CreateCircle =>
  async (cmd: CreateCircleCommand) => {
    const circle = Circle.create({
      id: deps.circleIds.next(),
      ownerId: cmd.ownerId,
      ownerMembershipId: deps.membershipIds.next(),
      name: cmd.name,
      now: deps.clock.now(),
    });

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(circle.id);
  };
