import { deadline, GpsImportError, type ImportLimits } from "@/lib/gps/errors";
import { isValidCoordinate } from "@/lib/gps/geo";
import type {
  ActivityProvenance,
  ActivitySegment,
  DeviceTotals,
  HeartRateSample,
  NormalisedActivity,
  ParseSkipReason,
  TrackPoint,
} from "@/lib/gps/types";

export const PARSER_VERSION = 1;

/** Plausible heart rate range; values outside it are treated as sensor noise and not kept. */
const MIN_BPM = 25;
const MAX_BPM = 250;

export interface RawRecord {
  t?: number;
  lat?: number;
  lon?: number;
  ele?: number;
  hr?: number;
  accuracy?: number;
  distance?: number;
  speed?: number;
}

const finite = (value: number | undefined) => (value !== undefined && Number.isFinite(value) ? value : undefined);

/**
 * Collects records from any parser into a `NormalisedActivity`, applying the
 * same rules everywhere: records without a usable time or position are
 * counted (never repaired), segments stay separate, and limits are enforced.
 */
export class ActivityBuilder {
  private segments: ActivitySegment[] = [];
  private current: TrackPoint[] | null = null;
  private currentSource: ActivitySegment["source"] = "whole";
  private heartRate: HeartRateSample[] = [];
  private skipped: Partial<Record<ParseSkipReason, number>> = {};
  private records = 0;
  private positioned = 0;
  private timed = 0;
  private invalidCoordinates = 0;
  private readonly tick: () => void;
  readonly channels = { elevation: false, heartRate: false, accuracy: false, distance: false, speed: false };

  constructor(private readonly limits: ImportLimits) {
    this.tick = deadline(limits);
  }

  startSegment(source: ActivitySegment["source"]) {
    this.endSegment();
    this.current = [];
    this.currentSource = source;
  }

  endSegment() {
    if (this.current?.length) this.segments.push({ points: this.current, source: this.currentSource });
    this.current = null;
  }

  private skip(reason: ParseSkipReason) {
    this.skipped[reason] = (this.skipped[reason] ?? 0) + 1;
  }

  add(record: RawRecord) {
    this.tick();
    this.records += 1;
    if (this.records > this.limits.maxRecords) {
      throw new GpsImportError(
        "limit_exceeded",
        `This file has more than ${this.limits.maxRecords.toLocaleString("en-GB")} records. Export a shorter activity and try again.`,
      );
    }
    const t = finite(record.t);
    const hasTime = t !== undefined;
    if (record.t !== undefined && !hasTime) this.skip("invalid-time");
    if (hasTime) this.timed += 1;

    const hr = finite(record.hr);
    if (hasTime && hr !== undefined && hr >= MIN_BPM && hr <= MAX_BPM) {
      this.heartRate.push({ t, bpm: hr });
      this.channels.heartRate = true;
    }

    const lat = finite(record.lat);
    const lon = finite(record.lon);
    if (lat === undefined || lon === undefined) {
      this.skip("missing-position");
      return;
    }
    this.positioned += 1;
    if (!isValidCoordinate(lat, lon)) {
      this.invalidCoordinates += 1;
      this.skip("invalid-coordinates");
      return;
    }
    if (!hasTime) {
      if (record.t === undefined) this.skip("missing-time");
      return;
    }
    const point: TrackPoint = { t, lat, lon };
    const ele = finite(record.ele);
    if (ele !== undefined) {
      point.ele = ele;
      this.channels.elevation = true;
    }
    const accuracy = finite(record.accuracy);
    if (accuracy !== undefined && accuracy >= 0) {
      point.accuracy = accuracy;
      this.channels.accuracy = true;
    }
    const distance = finite(record.distance);
    if (distance !== undefined && distance >= 0) {
      point.distance = distance;
      this.channels.distance = true;
    }
    const speed = finite(record.speed);
    if (speed !== undefined && speed >= 0) {
      point.speed = speed;
      this.channels.speed = true;
    }
    if (!this.current) this.startSegment(this.currentSource);
    this.current!.push(point);
  }

  finish(provenance: ActivityProvenance, deviceTotals?: DeviceTotals): NormalisedActivity {
    this.endSegment();
    const pointCount = this.segments.reduce((sum, segment) => sum + segment.points.length, 0);

    if (this.records === 0) {
      throw new GpsImportError("no_gps", "The file is valid but contains no track points or records.");
    }
    if (pointCount === 0) {
      if (this.positioned === 0) {
        throw new GpsImportError(
          "no_gps",
          "The file has no GPS positions. It may be an indoor or treadmill recording, or GPS was switched off.",
        );
      }
      if (this.invalidCoordinates === this.positioned) {
        throw new GpsImportError("invalid_coordinates", "Every position in the file is outside valid latitude and longitude ranges.");
      }
      if (this.timed === 0) {
        throw new GpsImportError("no_timestamps", "The positions have no timestamps, so time on the pitch can't be measured.");
      }
      throw new GpsImportError("no_gps", "No record in the file has both a valid position and a timestamp.");
    }

    let startTime = Infinity;
    let endTime = -Infinity;
    for (const segment of this.segments) {
      for (const point of segment.points) {
        if (point.t < startTime) startTime = point.t;
        if (point.t > endTime) endTime = point.t;
      }
    }
    if (endTime - startTime > this.limits.maxDurationMs) {
      throw new GpsImportError(
        "limit_exceeded",
        `The activity lasts more than ${Math.round(this.limits.maxDurationMs / 3_600_000)} hours. Trim it on your device or export just the match.`,
      );
    }
    this.heartRate.sort((a, b) => a.t - b.t);

    return {
      segments: this.segments,
      heartRate: this.heartRate,
      startTime,
      endTime,
      pointCount,
      skipped: this.skipped,
      channels: this.channels,
      deviceTotals,
      provenance,
    };
  }
}

/** Parses an XML dateTime. Times without a zone are read as UTC, which GPX and TCX require. */
export function parseXmlTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
  const time = Date.parse(zoned);
  return Number.isNaN(time) ? Number.NaN : time;
}

export function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  if (typeof value === "object" && value !== null && "#text" in value) return toNumber((value as { "#text": unknown })["#text"]);
  return undefined;
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
