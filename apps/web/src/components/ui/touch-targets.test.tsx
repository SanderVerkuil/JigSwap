// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { AvailabilityChips } from "../add-puzzle/availability-chips";
import { SegmentedPills } from "../add-puzzle/segmented-pills";
import { TagInput } from "../add-puzzle/tag-input";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Switch } from "./switch";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { TAB_TRIGGER_CLASS, UNDERLINE_TABS_LIST_CLASS } from "./underline-tabs";

// Under a finger (pointer: coarse) the shared controls reach the 44px touch target the app uses
// in onboarding and Reports (UX-70). The sizing lives in the primitives, behind pointer-coarse:,
// so fine-pointer (mouse) layouts keep their compact sizes. happy-dom has no layout, so these
// tests pin the classes; the browser check is the touch matrix in the commit message.

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("coarse-pointer touch targets", () => {
  it.each(["default", "sm", "lg", "icon", "public"] as const)(
    "gives a %s Button a 44px minimum on touch, even with a size override",
    (size) => {
      render(
        <Button size={size} className="size-8">
          Go
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Go" });
      expect(classes(button)).toEqual(
        expect.arrayContaining([
          "size-8",
          "pointer-coarse:min-h-11",
          "pointer-coarse:min-w-11",
        ]),
      );
    },
  );

  it("sizes a public Button at 50px, 10px round, 18px bold, over the compact base", () => {
    render(<Button size="public">Start your shelf</Button>);
    const list = classes(
      screen.getByRole("button", { name: "Start your shelf" }),
    );
    expect(list).toEqual(
      expect.arrayContaining([
        "h-[50px]",
        "rounded-[10px]",
        "px-[22px]",
        "text-[18px]",
        "font-bold",
        "pointer-coarse:min-h-11",
      ]),
    );
    for (const base of ["rounded-md", "text-sm", "font-medium"]) {
      expect(list).not.toContain(base);
    }
  });

  it("lets a caller opt a Button out on touch", () => {
    render(
      <Button size="sm" className="pointer-coarse:min-h-0">
        Go
      </Button>,
    );
    const list = classes(screen.getByRole("button", { name: "Go" }));
    expect(list).toContain("pointer-coarse:min-h-0");
    expect(list).not.toContain("pointer-coarse:min-h-11");
  });

  it("grows the Switch hit area to 44px on touch without changing its size", () => {
    render(<Switch aria-label="Email" />);
    const list = classes(screen.getByRole("switch", { name: "Email" }));
    expect(list).toEqual(
      expect.arrayContaining([
        "relative",
        "h-[1.15rem]",
        "w-8",
        "pointer-coarse:after:absolute",
        // 32×18.4 + 2×6px sideways and 2×13px up/down = 44×44.
        "pointer-coarse:after:-inset-x-1.5",
        "pointer-coarse:after:-inset-y-3.25",
      ]),
    );
  });

  it("grows the Checkbox hit area to 44px on touch without changing its size", () => {
    render(<Checkbox aria-label="All trades" />);
    const list = classes(screen.getByRole("checkbox", { name: "All trades" }));
    expect(list).toEqual(
      expect.arrayContaining([
        "relative",
        "size-4",
        "pointer-coarse:after:absolute",
        // 16 + 2×14px = 44.
        "pointer-coarse:after:-inset-3.5",
      ]),
    );
  });

  it("makes an Input 44px tall on touch, keeping its compact size for a mouse", () => {
    render(<Input aria-label="Title" />);
    const list = classes(screen.getByRole("textbox", { name: "Title" }));
    expect(list).toEqual(
      expect.arrayContaining(["h-9", "pointer-coarse:min-h-11"]),
    );
  });

  it.each(["default", "sm"] as const)(
    "makes a %s Select trigger 44px tall on touch",
    (size) => {
      render(
        <Select>
          <SelectTrigger aria-label="Status" size={size}>
            <SelectValue />
          </SelectTrigger>
        </Select>,
      );
      expect(classes(screen.getByRole("combobox"))).toContain(
        "pointer-coarse:min-h-11",
      );
    },
  );

  it("makes the Difficulty and Condition pills 44px tall on touch", () => {
    render(
      <SegmentedPills
        value="easy"
        onChange={() => {}}
        options={[{ value: "easy", label: "Easy" }]}
        ariaLabel="Difficulty"
      />,
    );
    expect(classes(screen.getByRole("radio", { name: "Easy" }))).toContain(
      "pointer-coarse:min-h-11",
    );
  });

  it("makes the Availability chips 44px tall on touch", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <AvailabilityChips
          value={{ forTrade: false, forLend: false, forSale: false }}
          onChange={() => {}}
        />
      </IntlProvider>,
    );
    expect(
      classes(screen.getByRole("button", { name: "For Trade" })),
    ).toContain("pointer-coarse:min-h-11");
  });

  it("makes an underline tab 44px tall on touch", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList className={UNDERLINE_TABS_LIST_CLASS}>
          <TabsTrigger value="a" className={TAB_TRIGGER_CLASS}>
            Following
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(classes(screen.getByRole("tab", { name: "Following" }))).toContain(
      "pointer-coarse:min-h-11",
    );
  });

  it("grows a tag's remove button to 44px on touch without changing the chip", () => {
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <TagInput value={["cats"]} onChange={() => {}} />
      </IntlProvider>,
    );
    expect(
      classes(
        screen.getByRole("button", {
          name: "Remove cats",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "relative",
        "size-6",
        "pointer-coarse:after:absolute",
        "pointer-coarse:after:-inset-2.5",
      ]),
    );
  });

  it("makes menu rows, including submenu triggers, 44px tall on touch", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add to collection</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    for (const name of ["Edit", "Add to collection"]) {
      expect(classes(screen.getByRole("menuitem", { name }))).toContain(
        "pointer-coarse:min-h-11",
      );
    }
  });
});
