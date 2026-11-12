/**
 * Playing intervals: the parts of a recording that were actual play. Warm-ups,
 * half-time and breaks fall outside them. Nothing assumes 90 minutes or two
 * halves; a player marks as many intervals as they played. Intervals are
 * never connected to each other, and the original timestamps are kept.
 */

import type { NormalisedActivity } from "@/lib/gps/types";

export const MAX_INTERVALS = 20;
/** Shorter intervals are allowed but flagged: they are usually a slip of the handle. */
export const SHORT_INTERVAL_MS = 60_000;

export interface PlayingInterval {
  /** UTC milliseconds, inclusive. */
  start: number;
  /** UTC milliseconds, inclusive. */
  end: number;
  /**
   * The teams changed ends before this interval. Its positions are turned
   * through the centre spot so "attacking" always points the same way.
   */
  switchedEnds?: boolean;
}

export interface IntervalCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  intervals: PlayingInterval[];
}

export function defaultIntervals(activity: Pick<NormalisedActivity, "startTime" | "endTime">): PlayingInterval[] {
  return [{ start: activity.startTime, end: activity.endTime }];
}

/** One interval per recorded segment: a sensible start when the player paused their watch at breaks. */
export function intervalsFromSegments(activity: NormalisedActivity): PlayingInterval[] {
  return activity.segments
    .map((segment) => ({ start: segment.points[0].t, end: segment.points.at(-1)!.t }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_INTERVALS);
}

/**
 * Sorts and checks intervals against the recording. Overlaps are reported
 * rather than merged, so the player decides what they meant.
 */
export function checkIntervals(
  intervals: PlayingInterval[],
  activity: Pick<NormalisedActivity, "startTime" | "endTime">,
): IntervalCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!intervals.length) errors.push("Mark at least one playing interval.");
  if (intervals.length > MAX_INTERVALS) errors.push(`Use at most ${MAX_INTERVALS} intervals.`);

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  sorted.forEach((interval, index) => {
    const label = `Interval ${index + 1}`;
    if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) errors.push(`${label} has an invalid time.`);
    else if (interval.end <= interval.start) errors.push(`${label} ends before it starts.`);
    else {
      if (interval.end < activity.startTime || interval.start > activity.endTime) {
        errors.push(`${label} is outside the recording.`);
      } else if (interval.start < activity.startTime || interval.end > activity.endTime) {
        warnings.push(`${label} runs past the recording; only the recorded part counts.`);
      }
      if (interval.end - interval.start < SHORT_INTERVAL_MS) warnings.push(`${label} is shorter than a minute.`);
    }
    const next = sorted[index + 1];
    if (next && next.start <= interval.end) errors.push(`${label} overlaps interval ${index + 2}.`);
  });

  return { ok: errors.length === 0, errors, warnings, intervals: sorted };
}

export function playingTimeMs(intervals: PlayingInterval[], activity?: Pick<NormalisedActivity, "startTime" | "endTime">) {
  return intervals.reduce((sum, interval) => {
    const start = activity ? Math.max(interval.start, activity.startTime) : interval.start;
    const end = activity ? Math.min(interval.end, activity.endTime) : interval.end;
    return sum + Math.max(0, end - start);
  }, 0);
}

/** The interval a timestamp falls in, or -1. Intervals must be sorted and non-overlapping. */
export function intervalIndexAt(intervals: PlayingInterval[], t: number) {
  let low = 0;
  let high = intervals.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const interval = intervals[middle];
    if (t < interval.start) high = middle - 1;
    else if (t > interval.end) low = middle + 1;
    else return middle;
  }
  return -1;
}
