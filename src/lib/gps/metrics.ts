/**
 * Match metrics from GPS. Every value says where it came from (see
 * `Provenance`), and anything the recording can't support is reported as
 * unavailable rather than estimated.
 *
 * - Calculated distance: great-circle distance between consecutive trusted
 *   samples inside playing intervals, never across a gap. GPS wobble adds a
 *   little; slow sampling cuts corners and under-reads.
 * - Device distance: the watch's own cumulative distance, differenced across
 *   each playing interval. Kept separate from the calculated figure.
 * - Playing time: the length of the playing intervals the player marked.
 * - Tracked time: the part of playing time covered by trusted samples.
 * - Average speed: calculated distance ÷ tracked time (gaps excluded).
 * - Top speed: the fastest stretch of at least `TOP_SPEED_WINDOW_S`, so a
 *   single noisy sample can't set it. Approximate when sampling is slower than
 *   every 1.5 s, unavailable slower than every 5 s.
 * - Heart rate: only from recorded samples inside playing intervals; the
 *   average is time-weighted so irregular sampling doesn't skew it.
 * - Sprints: a sprint is one or more overlapping `TOP_SPEED_WINDOW_S`-second
 *   stretches averaging at least `SPRINT_SPEED_MPS` (25.2 km/h); sprints
 *   less than `SPRINT_SEPARATION_S` apart count once. Only counted with
 *   1-second sampling, and always marked approximate.
 */

import { groundDistance } from "@/lib/gps/geo";
import type { ScreenedPoint } from "@/lib/gps/screen";
import type { PlayingInterval } from "@/lib/gps/trim";
import type { HeartRateSample, MetricValue } from "@/lib/gps/types";

export const TOP_SPEED_WINDOW_S = 3;
export const SPRINT_SPEED_MPS = 7;
export const SPRINT_SEPARATION_S = 5;
/** Heart rate samples further apart than this don't stretch to fill the gap. */
const HR_MAX_WEIGHT_MS = 5_000;

export interface MatchMetrics {
  playingTime: MetricValue;
  trackedTime: MetricValue;
  distance: MetricValue;
  deviceDistance: MetricValue;
  averageSpeed: MetricValue;
  topSpeed: MetricValue;
  heartRateAverage: MetricValue;
  heartRateMax: MetricValue;
  sprints: MetricValue;
}

const unavailable = (unit: MetricValue["unit"], note: string): MetricValue => ({ value: null, unit, provenance: "unavailable", note });

/** Device cumulative distance differenced across each interval; unavailable unless every interval has it. */
function deviceDistance(runs: ScreenedPoint[][], runInterval: number[], intervalCount: number): MetricValue {
  const byInterval = new Map<number, { first?: number; last?: number }>();
  for (const [runIndex, run] of runs.entries()) {
    const index = runInterval[runIndex];
    const entry = byInterval.get(index) ?? {};
    for (const point of run) {
      if (point.distance === undefined) continue;
      entry.first ??= point.distance;
      entry.last = point.distance;
    }
    byInterval.set(index, entry);
  }
  let total = 0;
  for (let index = 0; index < intervalCount; index += 1) {
    const entry = byInterval.get(index);
    if (!entry || entry.first === undefined || entry.last === undefined) {
      return unavailable("m", "The device didn't record its own distance for every playing interval.");
    }
    total += Math.max(0, entry.last - entry.first);
  }
  return { value: total, unit: "m", provenance: "device", note: "Reported by the device, across your playing intervals." };
}

export function computeMetrics({
  runs,
  runInterval,
  intervals,
  playingMs,
  heartRate,
  medianSamplingMs,
}: {
  /** Movement runs: trusted samples inside intervals, split at every break. */
  runs: ScreenedPoint[][];
  /** The playing interval each run belongs to. */
  runInterval: number[];
  intervals: PlayingInterval[];
  playingMs: number;
  heartRate: HeartRateSample[];
  medianSamplingMs: number;
}): MatchMetrics {
  let distance = 0;
  let trackedMs = 0;
  let topSpeed = 0;
  const slowSampling = medianSamplingMs > 1500;

  let sprints = 0;
  let lastSprintEnd = -Infinity;

  for (const run of runs) {
    const cumulative = [0];
    for (let index = 1; index < run.length; index += 1) {
      const step = groundDistance(run[index - 1], run[index]);
      distance += step;
      trackedMs += run[index].t - run[index - 1].t;
      cumulative.push(cumulative[index - 1] + step);
    }
    let end = 0;
    let inSprint = false;
    for (let start = 0; start < run.length; start += 1) {
      while (end < run.length && (run[end].t - run[start].t) / 1000 < TOP_SPEED_WINDOW_S) end += 1;
      if (end >= run.length) break;
      const seconds = (run[end].t - run[start].t) / 1000;
      const speed = (cumulative[end] - cumulative[start]) / seconds;
      if (speed > topSpeed) topSpeed = speed;
      if (speed >= SPRINT_SPEED_MPS) {
        if (!inSprint && (run[start].t - lastSprintEnd) / 1000 >= SPRINT_SEPARATION_S) sprints += 1;
        inSprint = true;
        lastSprintEnd = run[end].t;
      } else {
        inSprint = false;
      }
    }
  }

  const trackedSeconds = trackedMs / 1000;
  const distanceMetric: MetricValue =
    trackedMs > 0
      ? {
          value: distance,
          unit: "m",
          provenance: medianSamplingMs > 2000 ? "approximate" : "calculated",
          note:
            medianSamplingMs > 2000
              ? "Calculated from positions recorded every few seconds, which cuts corners and under-reads."
              : "Calculated from trusted GPS positions, gaps excluded. GPS wobble can add a few percent.",
        }
      : unavailable("m", "No continuous GPS inside your playing intervals.");

  const averageSpeed: MetricValue =
    trackedSeconds > 0
      ? { value: distance / trackedSeconds, unit: "m/s", provenance: distanceMetric.provenance, note: "Calculated distance ÷ tracked playing time (gaps excluded)." }
      : unavailable("m/s", "No tracked playing time.");

  let topSpeedMetric: MetricValue;
  if (medianSamplingMs > 5000 || topSpeed === 0) {
    topSpeedMetric = unavailable("m/s", "Positions were recorded too far apart to measure top speed.");
  } else {
    topSpeedMetric = {
      value: topSpeed,
      unit: "m/s",
      provenance: slowSampling ? "approximate" : "calculated",
      note: `Fastest ${TOP_SPEED_WINDOW_S}-second stretch, so one noisy point can't set it.${slowSampling ? " Sampling was slower than every 1.5 s." : ""}`,
    };
  }

  const sprintMetric: MetricValue =
    medianSamplingMs <= 1100 && trackedMs > 0
      ? {
          value: sprints,
          unit: "count",
          provenance: "approximate",
          note: `Stretches of ${TOP_SPEED_WINDOW_S}+ s averaging ${(SPRINT_SPEED_MPS * 3.6).toFixed(1)} km/h or faster. GPS smooths short bursts, so treat this as a guide.`,
        }
      : unavailable("count", "Sprints need positions recorded every second.");

  // Heart rate inside playing intervals, time-weighted.
  const inside = heartRate.filter((sample) => intervals.some((interval) => sample.t >= interval.start && sample.t <= interval.end));
  let heartRateAverage: MetricValue;
  let heartRateMax: MetricValue;
  if (inside.length < 2) {
    heartRateAverage = unavailable("bpm", "No heart rate was recorded during play.");
    heartRateMax = unavailable("bpm", "No heart rate was recorded during play.");
  } else {
    let weighted = 0;
    let weights = 0;
    let max = 0;
    for (let index = 0; index < inside.length; index += 1) {
      const next = inside[index + 1];
      const weight = next ? Math.min(next.t - inside[index].t, HR_MAX_WEIGHT_MS) : Math.min(HR_MAX_WEIGHT_MS, 1000);
      weighted += inside[index].bpm * weight;
      weights += weight;
      if (inside[index].bpm > max) max = inside[index].bpm;
    }
    heartRateAverage = { value: weights ? weighted / weights : null, unit: "bpm", provenance: "calculated", note: "Time-weighted average of the heart rate your device recorded during play." };
    heartRateMax = { value: max, unit: "bpm", provenance: "device", note: "Highest heart rate your device recorded during play." };
  }

  return {
    playingTime: { value: playingMs / 1000, unit: "s", provenance: "calculated", note: "The playing intervals you marked." },
    trackedTime: { value: trackedSeconds, unit: "s", provenance: "calculated", note: "Playing time covered by trusted GPS samples." },
    distance: distanceMetric,
    deviceDistance: deviceDistance(runs, runInterval, intervals.length),
    averageSpeed,
    topSpeed: topSpeedMetric,
    heartRateAverage,
    heartRateMax,
    sprints: sprintMetric,
  };
}
