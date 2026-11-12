/**
 * Sample screening: decides, point by point, which recorded samples are
 * trusted. Nothing is deleted. Every excluded point keeps its reason, so the
 * player can see what was left out and why.
 *
 * Heuristics (all constants below are exported and unit tested):
 *
 * 1. Duplicate timestamp: a point with the same time as the last accepted
 *    point is excluded (devices sometimes write a fix twice).
 * 2. Out of order: a point earlier than the last accepted point is excluded.
 * 3. Low accuracy: when the device reports horizontal accuracy, points worse
 *    than `MAX_ACCURACY_M` are excluded.
 * 4. Speed spike: moving from the last accepted point would need more than
 *    `MAX_SPEED_MPS` (plus `JITTER_M` of allowed GPS wobble). Elite players
 *    peak around 10–10.5 m/s, so this only catches GPS glitches.
 * 5. Position reset: if `RESET_RUN` spikes in a row agree with each other
 *    (and sit closer to each other than to the trusted path), the device
 *    really has moved, for example after regaining a fix. The latest is
 *    accepted and a break is recorded instead of a path. Points that follow
 *    such a run are never joined back to the old position, however much time
 *    has passed.
 * 6. Gap: when consecutive accepted points are more than `gapMs` apart
 *    (`GAP_MIN_MS`, or five typical sampling intervals if that is longer), a
 *    break is recorded. Time across a break is never counted as standing
 *    still, and no path is drawn across it.
 */

import { groundDistance, localProjection, median, quantile } from "@/lib/gps/geo";
import type { LatLon, NormalisedActivity } from "@/lib/gps/types";

export const MAX_SPEED_MPS = 12;
export const JITTER_M = 4;
export const RESET_RUN = 5;
export const MAX_ACCURACY_M = 25;
export const GAP_MIN_MS = 10_000;
export const GAP_SAMPLING_MULTIPLE = 5;

export type ExclusionReason = "duplicate-timestamp" | "out-of-order" | "low-accuracy" | "speed-spike" | "off-pitch";
export type BreakReason = "segment" | "gap" | "position-reset" | "interval" | "off-pitch";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  "duplicate-timestamp": "Duplicate timestamps",
  "out-of-order": "Out-of-order timestamps",
  "low-accuracy": `Device-reported accuracy worse than ${MAX_ACCURACY_M} m`,
  "speed-spike": `GPS jumps faster than ${MAX_SPEED_MPS} m/s`,
  "off-pitch": "Too far outside the pitch",
};

export interface ScreenedPoint {
  t: number;
  lat: number;
  lon: number;
  /** Metres east/north of the activity's reference point, for route previews. */
  e: number;
  n: number;
  segment: number;
  distance?: number;
  speed?: number;
  accuracy?: number;
  excluded?: ExclusionReason;
  /** Set on an accepted point that must not be joined to the accepted point before it. */
  breakBefore?: BreakReason;
}

export interface SamplingStats {
  medianMs: number;
  p95Ms: number;
  /** True when sampling is uneven or slower than 2 s ("smart recording"). */
  irregular: boolean;
}

export interface ScreenResult {
  points: ScreenedPoint[];
  reference: LatLon;
  sampling: SamplingStats;
  gapMs: number;
  gaps: { start: number; end: number }[];
  excluded: Partial<Record<ExclusionReason, number>>;
  accuracy: { reported: boolean; medianM: number | null };
}

/** The activity's median position: robust to a stray point far away. */
export function referencePoint(activity: NormalisedActivity): LatLon {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const segment of activity.segments) {
    for (const point of segment.points) {
      lats.push(point.lat);
      lons.push(point.lon);
    }
  }
  return { lat: median(lats), lon: median(lons) };
}

export function screenActivity(activity: NormalisedActivity): ScreenResult {
  const reference = referencePoint(activity);
  const projection = localProjection(reference);
  const ordered = activity.segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.points[0].t - b.segment.points[0].t);

  // Pass 1: order, duplicates and accuracy; collect sampling intervals.
  const points: ScreenedPoint[] = [];
  const intervals: number[] = [];
  const accuracies: number[] = [];
  let lastTime = -Infinity;
  for (const { segment, index } of ordered) {
    let previousInSegment: number | null = null;
    for (const raw of segment.points) {
      const { e, n } = projection.forward(raw);
      const point: ScreenedPoint = { t: raw.t, lat: raw.lat, lon: raw.lon, e, n, segment: index };
      if (raw.distance !== undefined) point.distance = raw.distance;
      if (raw.speed !== undefined) point.speed = raw.speed;
      if (raw.accuracy !== undefined) {
        point.accuracy = raw.accuracy;
        accuracies.push(raw.accuracy);
      }
      if (raw.t === lastTime) point.excluded = "duplicate-timestamp";
      else if (raw.t < lastTime) point.excluded = "out-of-order";
      else if (raw.accuracy !== undefined && raw.accuracy > MAX_ACCURACY_M) point.excluded = "low-accuracy";
      if (!point.excluded) {
        if (previousInSegment !== null) intervals.push(raw.t - previousInSegment);
        previousInSegment = raw.t;
        lastTime = raw.t;
      }
      points.push(point);
    }
  }

  const medianMs = intervals.length ? median(intervals) : 1000;
  const p95Ms = intervals.length ? quantile(intervals, 0.95) : 1000;
  const sampling: SamplingStats = { medianMs, p95Ms, irregular: medianMs > 2000 || p95Ms > medianMs * 3 };
  const gapMs = Math.max(GAP_MIN_MS, medianMs * GAP_SAMPLING_MULTIPLE);

  // Pass 2: speed spikes, position resets, gaps and segment breaks.
  const gaps: ScreenResult["gaps"] = [];
  let anchor: ScreenedPoint | null = null;
  let spikeRun: ScreenedPoint[] = [];
  for (const point of points) {
    if (point.excluded) continue;
    if (!anchor) {
      anchor = point;
      continue;
    }
    const dt = (point.t - anchor.t) / 1000;
    if (point.segment !== anchor.segment) {
      point.breakBefore = "segment";
      anchor = point;
      spikeRun = [];
      continue;
    }
    if (point.t - anchor.t > gapMs) {
      point.breakBefore = "gap";
      gaps.push({ start: anchor.t, end: point.t });
      anchor = point;
      spikeRun = [];
      continue;
    }
    const distance = groundDistance(anchor, point);
    const fromAnchor = distance <= MAX_SPEED_MPS * dt + JITTER_M;
    // Does this point agree with the run of rejected points (the device has moved) rather than the trusted path?
    const previous = spikeRun.at(-1);
    const fromRun = previous ? groundDistance(previous, point) : Infinity;
    const followsRun = previous !== undefined && fromRun <= MAX_SPEED_MPS * ((point.t - previous.t) / 1000) + JITTER_M && fromRun < distance;
    if (fromAnchor && !followsRun) {
      anchor = point;
      spikeRun = [];
      continue;
    }
    spikeRun = followsRun ? [...spikeRun, point] : [point];
    point.excluded = "speed-spike";
    if (spikeRun.length >= RESET_RUN) {
      point.excluded = undefined;
      point.breakBefore = "position-reset";
      anchor = point;
      spikeRun = [];
    }
  }

  const excluded: ScreenResult["excluded"] = {};
  for (const point of points) if (point.excluded) excluded[point.excluded] = (excluded[point.excluded] ?? 0) + 1;

  return {
    points,
    reference,
    sampling,
    gapMs,
    gaps,
    excluded,
    accuracy: { reported: accuracies.length > 0, medianM: accuracies.length ? median(accuracies) : null },
  };
}
