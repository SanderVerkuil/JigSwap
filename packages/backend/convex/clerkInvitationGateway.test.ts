import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clerkInvitationGateway,
  invitationErrorCode,
} from "./invitations/adapters/clerkInvitationGateway";

// The Clerk adapter for the InvitationGateway port, against a mocked Clerk client: no test reaches
// Clerk. It pins the request we make (notify: false, never ignoreExisting) and how Clerk's answers
// map onto the port.

const clerk = vi.hoisted(() => ({
  createClerkClient: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock("@clerk/backend", () => ({
  createClerkClient: clerk.createClerkClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
  clerk.createClerkClient.mockReturnValue({
    invitations: {
      createInvitation: clerk.createInvitation,
      revokeInvitation: clerk.revokeInvitation,
    },
  });
});

const INPUT = {
  email: "newbie@example.org",
  redirectUrl: "https://jigswap.site/sign-up",
  expiresInDays: 14,
  publicMetadata: { jsInvite: { kind: "follow", ref: "ref-1" } },
};

const gateway = () => clerkInvitationGateway({ secretKey: "sk_test_dummy" });

const clerkError = (code: string, status = 422) =>
  new ClerkAPIResponseError("Clerk refused", {
    data: [{ code, message: "refused", long_message: "refused" }],
    status,
  });

describe("clerkInvitationGateway.create", () => {
  it("creates the invitation without Clerk's email and never with ignoreExisting", async () => {
    clerk.createInvitation.mockResolvedValue({
      id: "inv_1",
      url: "https://clerk.example/ticket",
    });

    expect(await gateway().create(INPUT)).toEqual({
      kind: "created",
      id: "inv_1",
      url: "https://clerk.example/ticket",
    });
    expect(clerk.createClerkClient).toHaveBeenCalledWith({
      secretKey: "sk_test_dummy",
    });
    expect(clerk.createInvitation).toHaveBeenCalledWith({
      emailAddress: "newbie@example.org",
      redirectUrl: "https://jigswap.site/sign-up",
      expiresInDays: 14,
      publicMetadata: { jsInvite: { kind: "follow", ref: "ref-1" } },
      notify: false,
    });
    expect(clerk.createInvitation.mock.calls[0][0]).not.toHaveProperty(
      "ignoreExisting",
    );
  });

  it.each([[undefined], [""]])(
    "is no_url when the invitation has no link (%j)",
    async (url) => {
      clerk.createInvitation.mockResolvedValue({ id: "inv_2", url });
      expect(await gateway().create(INPUT)).toEqual({
        kind: "no_url",
        id: "inv_2",
      });
    },
  );

  it.each([["duplicate_record"], ["form_identifier_exists"]])(
    "maps Clerk's %s to exists",
    async (code) => {
      clerk.createInvitation.mockRejectedValue(clerkError(code));
      expect(await gateway().create(INPUT)).toEqual({ kind: "exists" });
    },
  );

  it("rethrows any other Clerk error", async () => {
    const error = clerkError("form_param_format_invalid");
    clerk.createInvitation.mockRejectedValue(error);
    await expect(gateway().create(INPUT)).rejects.toBe(error);
  });

  it("rethrows a network failure", async () => {
    clerk.createInvitation.mockRejectedValue(new TypeError("fetch failed"));
    await expect(gateway().create(INPUT)).rejects.toThrow("fetch failed");
  });
});

describe("clerkInvitationGateway.revoke", () => {
  it("revokes the invitation by id", async () => {
    clerk.revokeInvitation.mockResolvedValue({ id: "inv_1" });
    await gateway().revoke("inv_1");
    expect(clerk.revokeInvitation).toHaveBeenCalledWith("inv_1");
  });

  it("propagates a failure", async () => {
    clerk.revokeInvitation.mockRejectedValue(clerkError("not_found", 404));
    await expect(gateway().revoke("inv_1")).rejects.toBeInstanceOf(
      ClerkAPIResponseError,
    );
  });
});

describe("invitationErrorCode", () => {
  it("is Clerk's error code, the error's name, or unknown; never the message", () => {
    expect(invitationErrorCode(clerkError("not_found", 404))).toBe("not_found");
    expect(
      invitationErrorCode(
        new ClerkAPIResponseError("x", { data: [], status: 500 }),
      ),
    ).toBe("clerk_500");
    expect(invitationErrorCode(new TypeError("newbie@example.org"))).toBe(
      "TypeError",
    );
    expect(invitationErrorCode("newbie@example.org")).toBe("unknown");
  });
});
