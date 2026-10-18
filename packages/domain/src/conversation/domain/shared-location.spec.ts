import { describe, expect, it } from "vitest";
import { MAX_LOCATION_LABEL_LENGTH } from "./errors";
import {
  resolveLocationPrecision,
  SharedLocation,
  SharedLocationProps,
} from "./shared-location";

const create = (props: Partial<SharedLocationProps> = {}) =>
  SharedLocation.create({
    lat: 52.3731,
    lng: 4.8922,
    precision: "exact",
    ...props,
  });

const valueOf = (props: Partial<SharedLocationProps> = {}): SharedLocation => {
  const result = create(props);
  if (!result.isOk) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

// Kilometres per degree of latitude (mean Earth radius).
const KM_PER_DEGREE = 111.195;

describe("SharedLocation bounds", () => {
  it.each([
    [-90, -180],
    [90, 180],
    [0, 0],
  ])("accepts the boundary point (%d, %d)", (lat, lng) => {
    expect(create({ lat, lng }).isOk).toBe(true);
    expect(create({ lat, lng, precision: "approximate" }).isOk).toBe(true);
  });

  it.each([
    [90.000001, 0],
    [-90.5, 0],
    [0, 180.000001],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
    [0, Number.NEGATIVE_INFINITY],
  ])("rejects (%d, %d) with InvalidCoordinates", (lat, lng) => {
    const result = create({ lat, lng });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidCoordinates");
  });
});

describe("SharedLocation exact precision", () => {
  it("rounds to 5 decimals", () => {
    const location = valueOf({ lat: 52.3731234567, lng: 4.8922987654 });
    expect(location.lat).toBe(52.37312);
    expect(location.lng).toBe(4.8923);
    expect(location.precision).toBe("exact");
  });

  it("normalises a rounded -0 to 0", () => {
    const location = valueOf({ lat: -0.000001, lng: -0.000001 });
    expect(Object.is(location.lat, 0)).toBe(true);
    expect(Object.is(location.lng, 0)).toBe(true);
  });

  it("is idempotent", () => {
    const once = valueOf({ lat: 51.9244412, lng: 4.4777325 });
    const twice = valueOf({ lat: once.lat, lng: once.lng });
    expect([twice.lat, twice.lng]).toEqual([once.lat, once.lng]);
  });
});

describe("SharedLocation approximate precision (~1 km grid)", () => {
  it("snaps to 0.01° in both axes at the equator (cos 0 = 1)", () => {
    const location = valueOf({
      lat: 0.004,
      lng: 4.896,
      precision: "approximate",
    });
    expect(location.lat).toBe(0);
    expect(location.lng).toBe(4.9);
    expect(location.precision).toBe("approximate");
  });

  it("widens the longitude step by 1/cos(lat) at 52°N so the cell stays ~1 km wide", () => {
    const location = valueOf({
      lat: 52.0012,
      lng: 5.1234,
      precision: "approximate",
    });
    const lngStep = 0.01 / Math.cos((52 * Math.PI) / 180); // ≈ 0.016243°
    expect(location.lat).toBe(52);
    // 5.1234 / 0.016243 ≈ 315.4 -> cell 315.
    expect(location.lng).toBeCloseTo(315 * lngStep, 5);
    expect(location.lng).toBe(5.11645);
    // The cell is as wide as it is tall: ~1.11 km either way.
    const widthKm = lngStep * KM_PER_DEGREE * Math.cos((52 * Math.PI) / 180);
    expect(widthKm).toBeCloseTo(0.01 * KM_PER_DEGREE, 6);
  });

  it("moves a point by at most half a cell in each axis", () => {
    const lat = 52.3731;
    const lng = 4.8922;
    const location = valueOf({ lat, lng, precision: "approximate" });
    const lngStep = 0.01 / Math.cos((location.lat * Math.PI) / 180);
    expect(Math.abs(location.lat - lat)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(location.lng - lng)).toBeLessThanOrEqual(
      lngStep / 2 + 1e-5,
    );
  });

  it("maps every point of one cell to the same shared point", () => {
    const a = valueOf({ lat: 52.3712, lng: 4.8901, precision: "approximate" });
    const b = valueOf({ lat: 52.3738, lng: 4.8999, precision: "approximate" });
    expect([a.lat, a.lng]).toEqual([b.lat, b.lng]);
  });

  it.each([
    [0.004, 4.896],
    [52.0012, 5.1234],
    [52.3731, 4.8922],
    [-33.86882, 151.20929],
    [64.1466, -21.9426],
    [89.999, 179.999],
    [-89.999, -179.999],
  ])("is idempotent for (%d, %d)", (lat, lng) => {
    const once = valueOf({ lat, lng, precision: "approximate" });
    const twice = valueOf({
      lat: once.lat,
      lng: once.lng,
      precision: "approximate",
    });
    expect([twice.lat, twice.lng]).toEqual([once.lat, once.lng]);
  });

  it("keeps a snap near the antimeridian and the poles in range", () => {
    for (const [lat, lng] of [
      [52.37, 179.999],
      [52.37, -179.999],
      [89.999, 179.999],
      [-89.999, -179.999],
    ] as const) {
      const location = valueOf({ lat, lng, precision: "approximate" });
      expect(Math.abs(location.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(location.lng)).toBeLessThanOrEqual(180);
    }
  });
});

describe("SharedLocation label", () => {
  it("trims the label", () => {
    expect(valueOf({ label: "  Centraal Station  " }).label).toBe(
      "Centraal Station",
    );
  });

  it("drops a blank label", () => {
    expect(valueOf({ label: "   " }).label).toBeUndefined();
    expect(valueOf().label).toBeUndefined();
  });

  it("accepts MAX_LOCATION_LABEL_LENGTH characters after trimming", () => {
    const label = "x".repeat(MAX_LOCATION_LABEL_LENGTH);
    expect(valueOf({ label: `  ${label}  ` }).label).toBe(label);
  });

  it("rejects a longer label with LocationLabelTooLong", () => {
    const result = create({ label: "x".repeat(MAX_LOCATION_LABEL_LENGTH + 1) });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("LocationLabelTooLong");
  });
});

describe("resolveLocationPrecision (spec R.5)", () => {
  it.each([
    ["exact", true],
    ["exact", false],
    ["approximate", true],
    ["approximate", false],
  ] as const)(
    "a placed or searched pin is exact (requested %s, mutual %s)",
    (requested, mutualFollowers) => {
      expect(
        resolveLocationPrecision({ source: "pin", requested, mutualFollowers }),
      ).toBe("exact");
    },
  );

  it("current location is exact only when chosen AND the recipient is mutual", () => {
    expect(
      resolveLocationPrecision({
        source: "gps",
        requested: "exact",
        mutualFollowers: true,
      }),
    ).toBe("exact");
  });

  it("current location sent to a non-mutual is forced to approximate, even when exact was asked", () => {
    expect(
      resolveLocationPrecision({
        source: "gps",
        requested: "exact",
        mutualFollowers: false,
      }),
    ).toBe("approximate");
  });

  it("current location defaults to approximate for a mutual follower too", () => {
    expect(
      resolveLocationPrecision({
        source: "gps",
        requested: "approximate",
        mutualFollowers: true,
      }),
    ).toBe("approximate");
  });

  it("the resolved precision drives the rounding: a forced GPS fix lands on the grid", () => {
    const precision = resolveLocationPrecision({
      source: "gps",
      requested: "exact",
      mutualFollowers: false,
    });
    const shared = valueOf({ lat: 52.373123, lng: 4.892234, precision });
    expect(shared.precision).toBe("approximate");
    expect(shared.lat).toBe(52.37);
    expect(valueOf({ lat: shared.lat, lng: shared.lng, precision })).toEqual(
      shared,
    );
  });
});
