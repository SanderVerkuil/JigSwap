// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import type { CopyInstanceView } from "@jigswap/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CopyInstanceScreen } from "./copy-instance-screen";

const mocks = vi.hoisted(() => ({
  copy: undefined as unknown,
  household: undefined as unknown,
  editProps: undefined as { onAddPhotos?: () => void } | undefined,
}));

// The copy page for its manager, with the Edit dialog stubbed to expose what the page hands it.
const managedCopy = (over: {
  snapshot?: object;
  pendingPhotos?: object[];
  photoLimit?: number;
  household?: object;
  viewerIsOwner?: boolean;
}) =>
  ({
    copyId: "copy_1",
    aggregateId: "aggregate_1",
    puzzleId: "puzzle_1",
    viewerIsOwner: over.viewerIsOwner ?? true,
    viewerCanManage: true,
    viewerMayRequest: false,
    household: over.household ?? null,
    owner: { anonymous: true },
    completions: [],
    copyReviews: [],
    loans: [],
    transfers: [],
    pendingPhotos: over.pendingPhotos ?? [],
    gallery: [],
    photoLimit: over.photoLimit ?? 5,
    stats: { timesCompleted: 0, timesLentOut: 0 },
    community: {
      count: 0,
      rating: null,
      label: null,
      breakdown: [],
      percentages: [],
    },
    snapshot: {
      title: "The Night Watch",
      pieceCount: 1000,
      availability: { forTrade: false, forSale: false, forLend: false },
      tags: [],
      condition: "good",
      visibility: "visible",
      ...over.snapshot,
    },
  }) as unknown as CopyInstanceView;

vi.mock("./edit-copy-dialog", () => ({
  EditCopyDialog: (props: { onAddPhotos?: () => void }) => {
    mocks.editProps = props;
    return null;
  },
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (ref: FunctionReference<"query">, args: unknown) => ({
    name: getFunctionName(ref),
    args,
  }),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ name }: { name: string }) => ({
    data: name.endsWith("getCopyInstanceView")
      ? mocks.copy
      : name === getFunctionName(gateway.household.mine)
        ? mocks.household
        : undefined,
    isPending: false,
    isError: false,
  }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
  usePageHeaderActions: () => {},
}));

const renderCopy = (copy: CopyInstanceView) => {
  mocks.copy = copy;
  mocks.editProps = undefined;
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <CopyInstanceScreen copyId="copy_1" owned />
    </IntlProvider>,
  );
};

afterEach(cleanup);

describe("Edit copy's Add photo", () => {
  it("is offered while the copy has room for a photo", () => {
    renderCopy(managedCopy({ pendingPhotos: [{ createdAt: 1 }] }));
    expect(mocks.editProps?.onAddPhotos).toBeTypeOf("function");
  });

  // The photo strip renders no file input then, so the button would only close the dialog.
  it("isn't offered once photos still being checked fill the limit", () => {
    renderCopy(
      managedCopy({
        photoLimit: 2,
        pendingPhotos: [{ createdAt: 1 }, { createdAt: 2 }],
      }),
    );
    expect(mocks.editProps?.onAddPhotos).toBeUndefined();
  });
});

describe("Household access", () => {
  const ownerFacts = {
    permission: "manage",
    viewerAccess: "owner",
    inheritsDefault: true,
    householdDefault: "manage",
  };
  const accessLabel = en.household.copyAccess.label;

  it("is offered to an owner sharing a household", () => {
    mocks.household = { members: [{ _id: "me" }, { _id: "anna" }] };
    renderCopy(managedCopy({ household: ownerFacts }));
    expect(screen.getByText(accessLabel)).toBeTruthy();
  });

  it("isn't offered to an owner alone in their household", () => {
    mocks.household = { members: [{ _id: "me" }] };
    renderCopy(managedCopy({ household: ownerFacts }));
    expect(screen.queryByText(accessLabel)).toBeNull();
  });

  it("still tells a housemate what they may do", () => {
    mocks.household = undefined;
    renderCopy(
      managedCopy({
        viewerIsOwner: false,
        household: { ...ownerFacts, viewerAccess: "view" },
      }),
    );
    expect(screen.getByText(en.household.copyAccess.memberView)).toBeTruthy();
  });
});

describe("the hero on a phone", () => {
  // happy-dom has no layout: this pins the class contract; the geometry was checked in a browser.
  it("puts the cover beside the title and the rest full width below", () => {
    renderCopy(managedCopy({}));
    const hero = screen.getByRole("heading", { level: 1 }).closest("section");
    expect(hero?.className).toContain("grid-cols-[7.5rem_minmax(0,1fr)]");
    expect(hero?.className).toContain("sm:grid-cols-1");
    expect(
      screen.getByTestId("copy-status-line").closest(".max-sm\\:col-span-2"),
    ).toBeTruthy();
  });
});

describe("the acquisition date", () => {
  it("shows the recorded month", () => {
    renderCopy(
      managedCopy({ snapshot: { acquisitionDate: Date.UTC(2025, 2, 1, 12) } }),
    );
    expect(screen.getByText("Mar 2025")).toBeTruthy();
  });

  // Stored before the server refused such values: the page must still open, and the manager keeps
  // the way to fix it.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1e20])(
    "treats %s as not recorded instead of breaking the page",
    (acquisitionDate) => {
      renderCopy(managedCopy({ snapshot: { acquisitionDate } }));
      expect(
        screen.getByRole("button", { name: en.copyInstance.addDetails }),
      ).toBeTruthy();
    },
  );
});
