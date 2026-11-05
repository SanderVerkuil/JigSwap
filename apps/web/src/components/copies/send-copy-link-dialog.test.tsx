// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { SendCopyLinkDialog } from "./send-copy-link-dialog";

const renderDialog = (
  visibility: "public" | "private",
  viewerIsOwner = true,
) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(convexQuery(gateway.social.profile, {}).queryKey, {
    _id: "profile_1",
    _creationTime: 0,
    memberId: "m1",
    visibility,
    updatedAt: 0,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <SendCopyLinkDialog
          copyId="copy_1"
          title="De Kattenshow"
          viewerIsOwner={viewerIsOwner}
          open
          onOpenChange={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("SendCopyLinkDialog", () => {
  it("prefills the share sheet with the copy's own flagged link and its title", () => {
    renderDialog("public");
    const expected = `${window.location.origin}/copies/copy_1?shared=1`;
    const whatsApp = screen.getByRole("link", { name: "WhatsApp" });
    const text = decodeURIComponent(whatsApp.getAttribute("href")!);
    expect(text).toContain(expected);
    expect(text).toContain("De Kattenshow");
    expect(text).not.toContain("Join me on JigSwap");
    expect(
      screen.getByRole("button", { name: en.invite.copyLink }),
    ).toBeTruthy();
    expect(screen.queryByText(en.copyInstance.sendLink.privateNote)).toBeNull();
  });

  it("tells an owner with a private profile who can open it", () => {
    renderDialog("private");
    expect(screen.getByText(en.copyInstance.sendLink.privateNote)).toBeTruthy();
  });

  it("says nothing about a co-manager's own profile: it isn't the owner's", () => {
    renderDialog("private", false);
    expect(screen.queryByText(en.copyInstance.sendLink.privateNote)).toBeNull();
  });
});
