import { err, ok, Result } from "../../shared-kernel";
import { ConversationError, MAX_LOCATION_LABEL_LENGTH } from "./errors";

// How precisely a location is shared. `exact`: a pin the member placed deliberately (a chosen
// public spot), kept at 5 decimals (~1 m). `approximate`: "use my current location", snapped to a
// ~1 km grid so the member's actual position is not revealed.
export type LocationPrecision = "exact" | "approximate";

export interface SharedLocationProps {
  readonly lat: number;
  readonly lng: number;
  readonly precision: LocationPrecision;
  readonly label?: string;
}

// The approximate grid: 0.01° of latitude (~1.11 km). The longitude step is scaled by
// 1 / cos(lat) so a cell stays ~1.11 km wide away from the equator.
const GRID_DEGREES = 0.01;
// Near the poles cos(lat) -> 0 and the longitude step would blow up; floor it so the step never
// exceeds 1°.
const MIN_COS = 0.01;

// Round to 5 decimals, normalising -0 to 0 so equal positions compare and store equal.
const round5 = (value: number): number => {
  const rounded = Math.round(value * 1e5) / 1e5;
  return rounded === 0 ? 0 : rounded;
};

const clamp = (value: number, limit: number): number =>
  Math.min(limit, Math.max(-limit, value));

// Snap to the centre-aligned grid. Latitude snaps first; the longitude step derives from the
// SNAPPED latitude, so every point in a cell shares one step and snapping is idempotent.
const snapApproximate = (lat: number, lng: number): [number, number] => {
  const snappedLat = clamp(Math.round(lat / GRID_DEGREES) * GRID_DEGREES, 90);
  const cos = Math.max(
    MIN_COS,
    Math.abs(Math.cos((snappedLat * Math.PI) / 180)),
  );
  const lngStep = GRID_DEGREES / cos;
  const snappedLng = clamp(Math.round(lng / lngStep) * lngStep, 180);
  return [round5(snappedLat), round5(snappedLng)];
};

// SharedLocation: a one-shot place shared in a conversation (never live). Pure value object: it
// range-checks the coordinates, rounds them by precision (so only the shared coordinates are ever
// stored, never the raw device fix) and trims the optional label.
export class SharedLocation {
  private constructor(
    readonly lat: number,
    readonly lng: number,
    readonly precision: LocationPrecision,
    readonly label: string | undefined,
  ) {}

  static create(
    props: SharedLocationProps,
  ): Result<SharedLocation, ConversationError> {
    const { lat, lng, precision } = props;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return err(ConversationError.invalidCoordinates());
    }

    const label = props.label?.trim();
    if (label !== undefined && label.length > MAX_LOCATION_LABEL_LENGTH) {
      return err(ConversationError.locationLabelTooLong());
    }

    const [sharedLat, sharedLng] =
      precision === "exact"
        ? [round5(lat), round5(lng)]
        : snapApproximate(lat, lng);
    return ok(
      new SharedLocation(
        sharedLat,
        sharedLng,
        precision,
        label === "" ? undefined : label,
      ),
    );
  }
}
