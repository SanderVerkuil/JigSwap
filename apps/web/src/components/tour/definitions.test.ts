import { promises as fs } from "node:fs";
import path from "node:path";
import { getRouteMeta } from "@/components/dashboard-layout/route-meta";
import { STANDALONE_TOUR_IDS, WHATS_NEW_MANIFEST } from "@jigswap/contracts";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  GUIDE_AREAS,
  guideMessageKeys,
  stepMessageKeys,
  TOURS,
} from "./definitions";

// Static checks that keep tours, the What's new manifest, the locale files and the data-tour
// anchors in agreement: each of these fails silently at runtime (unknown_tour, a raw key on the
// card, or a step that always falls back to the centred card).

// The backend's MAX_TOUR_STEPS: a step index at or past it is rejected as invalid_step.
const MAX_TOUR_STEPS = 50;

const lookup = (messages: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (
      /\.tsx?$/.test(dirent.name) &&
      !/\.(test|spec)\./.test(dirent.name)
    )
      out.push(full);
  }
  return out;
}

describe("tour definitions", () => {
  // recordTourProgress accepts a tour id only when a manifest entry references it or it is in
  // STANDALONE_TOUR_IDS; anything else is rejected as unknown_tour at runtime.
  const referenced = new Set(
    WHATS_NEW_MANIFEST.flatMap((entry) => (entry.tour ? [entry.tour] : [])),
  );
  const standalone = new Set<string>(STANDALONE_TOUR_IDS);

  it("are each referenced by a What's new entry or registered as standalone", () => {
    for (const id of TOURS.keys()) {
      expect(referenced.has(id) || standalone.has(id), id).toBe(true);
    }
  });

  it("define every tour the manifest references and every standalone tour", () => {
    for (const id of [...referenced, ...standalone]) {
      expect(TOURS.has(id), id).toBe(true);
    }
  });

  it("keep standalone tours out of the manifest", () => {
    for (const id of standalone) expect(referenced.has(id), id).toBe(false);
  });

  it("include the quick start's getting-started tour on existing anchors", () => {
    expect(TOURS.get("getting-started")?.steps).toEqual([
      { id: "shelf", route: "/dashboard", target: "dashboard-shelf" },
      { id: "solving-now", route: "/dashboard", target: "solving-now" },
      { id: "people", route: "/people", target: "people-network" },
      {
        id: "account-menu",
        route: "/dashboard",
        target: "account-menu",
        side: "right",
        align: "end",
      },
    ]);
  });

  it("have unique step ids, a page title per route, and fit the backend's step limit", () => {
    for (const tour of TOURS.values()) {
      expect(tour.steps.length).toBeGreaterThan(0);
      expect(tour.steps.length).toBeLessThanOrEqual(MAX_TOUR_STEPS);
      const ids = tour.steps.map((step) => step.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const step of tour.steps) {
        expect(getRouteMeta(step.route), step.route).toBeDefined();
      }
    }
  });

  it("have title and body copy in every locale file", () => {
    for (const tour of TOURS.values()) {
      for (const step of tour.steps) {
        const keys = stepMessageKeys(tour.id, step.id);
        for (const [name, messages] of Object.entries({ en, nl, source })) {
          for (const key of [keys.title, keys.body]) {
            const value = lookup(messages, key);
            expect(
              typeof value === "string" && value.length > 0,
              `${name}: ${key}`,
            ).toBe(true);
          }
        }
        // source mirrors en.
        expect(lookup(source, keys.body)).toBe(lookup(en, keys.body));
      }
    }
  });

  it("are each listed as a guide in a known area, with a title and description", () => {
    for (const tour of TOURS.values()) {
      expect(GUIDE_AREAS, tour.id).toContain(tour.guide.area);
      const keys = guideMessageKeys(tour.id);
      for (const [name, messages] of Object.entries({ en, nl, source })) {
        for (const key of [keys.title, keys.description]) {
          const value = lookup(messages, key);
          expect(
            typeof value === "string" && value.length > 0,
            `${name}: ${key}`,
          ).toBe(true);
        }
      }
      expect(lookup(source, keys.description)).toBe(
        lookup(en, keys.description),
      );
    }
  });

  // Every tour is a guide, most of them for features that aren't new: the shared end-of-tour toast
  // must not call the feature new.
  it("end with a completion toast that fits every tour", () => {
    for (const [name, messages] of Object.entries({ en, nl, source })) {
      const value = lookup(messages, "tour.completed");
      expect(typeof value === "string" && value.length > 0, name).toBe(true);
      expect(value as string, name).not.toMatch(/new feature|nieuwe functie/i);
    }
    expect(lookup(source, "tour.completed")).toBe(lookup(en, "tour.completed"));
  });

  it("point at data-tour anchors that exist in the app", async () => {
    const root = path.resolve(__dirname, "../..");
    const files = (await sourceFiles(root)).filter(
      (file) => !file.startsWith(path.join(root, "components/tour")),
    );
    const code = (
      await Promise.all(files.map((f) => fs.readFile(f, "utf8")))
    ).join("\n");
    for (const tour of TOURS.values()) {
      for (const step of tour.steps) {
        if (step.target === undefined) continue;
        expect(code, `${tour.id}/${step.id}`).toContain(
          `data-tour="${step.target}"`,
        );
      }
    }
  });
});
