/**
 * The normalised GPS activity every provider produces, and the pitch
 * coordinate system the analytics work in. Nothing here depends on React,
 * Three.js or Supabase.
 *
 * Rules that hold throughout the GPS module:
 * - Timestamps are UTC milliseconds since the Unix epoch.
 * - A value the device didn't record is left out (undefined). Missing
 *   coordinates, heart rate or accuracy are never invented or interpolated
 *   into stored data.
 * - Device-reported values (distance, speed, accuracy) are kept apart from
 *   values this app calculates.
 */

export type SourceFormat = "gpx" | "tcx" | "fit";

/** Where an activity came from. Only `file` exists today; see `adapter.ts`. */
export type ActivityProvider = "file";

export interface TrackPoint {
  /** UTC milliseconds since the Unix epoch. */
  t: number;
  /** WGS84 degrees. */
  lat: number;
  lon: number;
  /** Metres, as recorded (device altitude, not corrected). */
  ele?: number;
  /** Device-reported horizontal accuracy in metres (FIT `gps_accuracy`). */
  accuracy?: number;
  /** Device-reported cumulative distance in metres. */
  distance?: number;
  /** Device-reported speed in m/s. */
  speed?: number;
}

export interface HeartRateSample {
  t: number;
  /** Beats per minute, as recorded. */
  bpm: number;
}

/**
 * A continuous run of recording. Segments are never joined: a gap between
 * two segments is a period the device wasn't recording (a pause, a lap
 * reset after a stop, or a new GPX `trkseg`).
 */
export interface ActivitySegment {
  points: TrackPoint[];
  /** What split this segment from the previous one in the source file. */
  source: "trkseg" | "tcx-track" | "fit-timer" | "whole";
}

export interface ActivityProvenance {
  provider: ActivityProvider;
  format: SourceFormat;
  /** GPX `creator`, TCX `Creator/Name`, or FIT manufacturer/product. */
  creator?: string;
  /** GPX version, TCX schema, or FIT profile version. */
  formatVersion?: string;
  sport?: string;
  byteSize: number;
  parserVersion: number;
  /** Things the parser noticed and the player should know about. */
  notes: string[];
}

/** Totals the device itself reported in a session or lap summary. */
export interface DeviceTotals {
  distance?: number;
  elapsedSeconds?: number;
  timerSeconds?: number;
}

export interface NormalisedActivity {
  segments: ActivitySegment[];
  /** Every recorded heart-rate sample, with or without a position fix. */
  heartRate: HeartRateSample[];
  startTime: number;
  endTime: number;
  /** Points with a valid position and timestamp, across all segments. */
  pointCount: number;
  /** Records the parser had to skip, by reason, so nothing disappears silently. */
  skipped: Partial<Record<ParseSkipReason, number>>;
  channels: {
    elevation: boolean;
    heartRate: boolean;
    accuracy: boolean;
    distance: boolean;
    speed: boolean;
  };
  deviceTotals?: DeviceTotals;
  provenance: ActivityProvenance;
}

export type ParseSkipReason =
  | "missing-time"
  | "missing-position"
  | "invalid-coordinates"
  | "invalid-time";

/**
 * Pitch coordinates, in metres, independent of any renderer.
 *
 * - Origin: the corner where the player's own (defending) goal line meets
 *   their left touchline, as seen when attacking.
 * - x runs along the length towards the opposition goal: 0 → `length`.
 * - y runs across the width from the left touchline: 0 → `width`.
 *
 * This matches `POSITION_META` in `src/lib/domain.ts`. Points can lie
 * outside [0, length] × [0, width]; they are never clamped or snapped.
 */
export interface PitchPoint {
  x: number;
  y: number;
}

export interface PitchDimensions {
  length: number;
  width: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * How a value was obtained:
 * - `device`: reported by the watch or phone that recorded the file.
 * - `calculated`: computed here from recorded samples.
 * - `approximate`: computed here, but the data limits how far to trust it.
 * - `unavailable`: the recording doesn't support it.
 */
export type Provenance = "device" | "calculated" | "approximate" | "unavailable";

export interface MetricValue {
  value: number | null;
  unit: "m" | "s" | "m/s" | "bpm" | "count";
  provenance: Provenance;
  note?: string;
}
