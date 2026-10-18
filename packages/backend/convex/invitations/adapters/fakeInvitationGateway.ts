import type {
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationGateway,
} from "./invitationGateway";

// An in-memory InvitationGateway for tests (swapped in for makeInvitationGatewayFromEnv with
// vi.mock). `nextCreate` picks the answer to the next create calls; every call is recorded.
export type FakeCreateOutcome = CreateInvitationResult["kind"] | "error";

export interface FakeInvitationGateway extends InvitationGateway {
  nextCreate: FakeCreateOutcome;
  failRevoke: boolean;
  failDelete: boolean;
  readonly created: CreateInvitationInput[];
  readonly revoked: string[];
  readonly deleted: string[];
}

export const makeFakeInvitationGateway = (): FakeInvitationGateway => {
  let seq = 0;
  const fake: FakeInvitationGateway = {
    nextCreate: "created",
    failRevoke: false,
    failDelete: false,
    created: [],
    revoked: [],
    deleted: [],
    async create(input) {
      fake.created.push(input);
      seq += 1;
      const id = `inv_fake_${seq}`;
      switch (fake.nextCreate) {
        case "created":
          return {
            kind: "created",
            id,
            url: `https://clerk.example/v1/tickets/accept?ticket=${id}`,
          };
        case "exists":
          return { kind: "exists" };
        case "no_url":
          return { kind: "no_url", id };
        case "error":
          throw new Error("fake gateway failure");
      }
    },
    async revoke(id) {
      fake.revoked.push(id);
      if (fake.failRevoke) throw new Error("fake revoke failure");
    },
    async delete(id) {
      fake.deleted.push(id);
      if (fake.failDelete) throw new Error("fake delete failure");
    },
  };
  return fake;
};
