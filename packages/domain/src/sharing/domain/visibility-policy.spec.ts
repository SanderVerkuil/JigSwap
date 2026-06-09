import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { CircleId, MemberId } from "./ids";
import { VisibilityPolicy } from "./visibility-policy";
import { TransactionKind, VisibilityScope } from "./visibility-scope";

const owner = toId<"MemberId">("owner") as MemberId;
const peer = toId<"MemberId">("peer") as MemberId; // shares a circle with the owner
const stranger = toId<"MemberId">("stranger") as MemberId; // shares no circle

const sharedCircle = toId<"CircleId">("circle-1") as CircleId;
const SHARED: readonly CircleId[] = [sharedCircle];
const NONE: readonly CircleId[] = [];

const ALL_SCOPES: VisibilityScope[] = [
  "private",
  "friendCircle",
  "visible",
  "lendable",
  "swappable",
  "tradeable",
];

describe("VisibilityPolicy.canView", () => {
  it("always lets the owner view their own content, at every scope", () => {
    for (const scope of ALL_SCOPES) {
      expect(VisibilityPolicy.canView(owner, owner, scope, NONE)).toBe(true);
    }
  });

  describe("private", () => {
    it("hides from a circle peer and a stranger", () => {
      expect(VisibilityPolicy.canView(peer, owner, "private", SHARED)).toBe(false);
      expect(VisibilityPolicy.canView(stranger, owner, "private", NONE)).toBe(false);
    });
  });

  describe("friendCircle", () => {
    it("shows to a viewer who shares a circle with the owner", () => {
      expect(VisibilityPolicy.canView(peer, owner, "friendCircle", SHARED)).toBe(true);
    });

    it("hides from a viewer who shares no circle", () => {
      expect(VisibilityPolicy.canView(stranger, owner, "friendCircle", NONE)).toBe(false);
    });
  });

  describe.each(["visible", "lendable", "swappable", "tradeable"] as const)(
    "%s (public view)",
    (scope) => {
      it("shows to both a circle peer and a stranger", () => {
        expect(VisibilityPolicy.canView(peer, owner, scope, SHARED)).toBe(true);
        expect(VisibilityPolicy.canView(stranger, owner, scope, NONE)).toBe(true);
      });
    },
  );
});

describe("VisibilityPolicy.canTransact", () => {
  const KINDS: TransactionKind[] = ["lend", "swap", "trade"];

  it("always lets the owner transact on their own content, any scope and kind", () => {
    for (const scope of ALL_SCOPES) {
      for (const kind of KINDS) {
        expect(VisibilityPolicy.canTransact(owner, owner, scope, NONE, kind)).toBe(true);
      }
    }
  });

  describe.each(["private", "friendCircle", "visible"] as const)(
    "%s never permits a public transaction",
    (scope) => {
      it.each(KINDS)("denies %s for a peer and a stranger", (kind) => {
        expect(VisibilityPolicy.canTransact(peer, owner, scope, SHARED, kind)).toBe(false);
        expect(VisibilityPolicy.canTransact(stranger, owner, scope, NONE, kind)).toBe(
          false,
        );
      });
    },
  );

  // Each transactable scope permits exactly its own kind, for any non-owner viewer.
  const matrix: ReadonlyArray<[VisibilityScope, TransactionKind]> = [
    ["lendable", "lend"],
    ["swappable", "swap"],
    ["tradeable", "trade"],
  ];

  describe.each(matrix)("%s permits only %s", (scope, allowed) => {
    it(`allows ${allowed} for a stranger (public)`, () => {
      expect(VisibilityPolicy.canTransact(stranger, owner, scope, NONE, allowed)).toBe(
        true,
      );
    });

    it.each(KINDS.filter((k) => k !== allowed))(
      "denies the other kind %s",
      (other) => {
        expect(VisibilityPolicy.canTransact(stranger, owner, scope, NONE, other)).toBe(
          false,
        );
      },
    );
  });
});
