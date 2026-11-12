/**
 * The processing pipeline: a screened activity, the player's playing
 * intervals and a pitch calibration in; a versioned tracking result out.
 * Pure and deterministic, so it runs the same in a worker, on the main
 * thread or in tests, and stored results can be regenerated from the source
 * file plus `intervals`, `calibration` and `algorithmVersion`.
 */

import { createTransform, type CalibrationFit, type PitchCalibration } from "@/lib/gps/calibration";
import {
  buildHeatGrid,
  DEFAULT_HEATMAP_OPTIONS,
  gridZoneShares,
  HEATMAP_ALGORITHM_VERSION,
  placement,
  type HeatGrid,
  type HeatmapOptions,
  type PitchSample,
  type Placement,
  type ZoneShare,
} from "@/lib/gps/heatmap";
import { computeMetrics, type MatchMetrics } from "@/lib/gps/metrics";
import { classifyQuality, type QualityReport } from "@/lib/gps/quality";
import type { ExclusionReason, ScreenedPoint, ScreenResult } from "@/lib/gps/screen";
import { checkIntervals, intervalIndexAt, playingTimeMs, type PlayingInterval } from "@/lib/gps/trim";
import type { NormalisedActivity, PitchDimensions } from "@/lib/gps/types";

/** Bumped whenever the output for the same input would change. */
export const ALGORITHM_VERSION = HEATMAP_ALGORITHM_VERSION;

/** Most points returned for drawing; all points are always used for the numbers. */
export const PREVIEW_POINT_LIMIT = 4000;

export interface PreviewPoint {
  x: number;
  y: number;
  placement: Placement;
  /** True when this point starts a new run: don't draw a line to it. */
  breakBefore: boolean;
}

export interface TrackingCounts {
  /** Every point in the recording. */
  recorded: number;
  /** Points outside the playing intervals (warm-up, breaks): trimmed, not errors. */
  outsideIntervals: number;
  /** Trusted points inside the intervals, on or off the pitch. */
  valid: number;
  inBounds: number;
  nearLines: number;
  /** Excluded points by reason, including those too far off the pitch. */
  excluded: Partial<Record<ExclusionReason, number>>;
}

export interface TrackingResult {
  algorithmVersion: number;
  heatmapOptions: HeatmapOptions;
  pitch: PitchDimensions;
  calibration: PitchCalibration;
  calibrationFit: Pick<CalibrationFit, "rms" | "residuals" | "measuredSides" | "attackBearing">;
  intervals: PlayingInterval[];
  grid: HeatGrid;
  counts: TrackingCounts;
  quality: QualityReport;
  metrics: MatchMetrics;
  zones: { thirds: ZoneShare[]; channels: ZoneShare[] };
  diagnostics: {
    medianSamplingMs: number;
    gapCount: number;
    gapThresholdMs: number;
    playingMs: number;
    trackedMs: number;
    onPitchMs: number;
    accuracyMedianM: number | null;
  };
  /** Decimated pitch positions for drawing. Not stored. */
  preview: PreviewPoint[];
}

export class ProcessingError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "ProcessingError";
  }
}

function decimate<T>(items: T[], limit: number, keep: (item: T) => boolean): T[] {
  if (items.length <= limit) return items;
  const stride = Math.ceil(items.length / limit);
  return items.filter((item, index) => index % stride === 0 || keep(item));
}

export function processTracking({
  activity,
  screen,
  intervals,
  calibration,
  options = DEFAULT_HEATMAP_OPTIONS,
}: {
  activity: NormalisedActivity;
  screen: ScreenResult;
  intervals: PlayingInterval[];
  calibration: PitchCalibration;
  options?: HeatmapOptions;
}): TrackingResult {
  const check = checkIntervals(intervals, activity);
  if (!check.ok) throw new ProcessingError(check.errors);
  const transform = createTransform(calibration);
  if (!transform.fit.ok) throw new ProcessingError(transform.fit.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message));

  const sorted = check.intervals;
  const pitch = { length: calibration.length, width: calibration.width };
  const counts: TrackingCounts = { recorded: screen.points.length, outsideIntervals: 0, valid: 0, inBounds: 0, nearLines: 0, excluded: {} };
  const exclude = (reason: ExclusionReason) => (counts.excluded[reason] = (counts.excluded[reason] ?? 0) + 1);

  const movementRuns: ScreenedPoint[][] = [];
  const runInterval: number[] = [];
  const pitchRuns: PitchSample[][] = [];
  const preview: PreviewPoint[] = [];
  let screenedInIntervals = 0;
  let screenedExcluded = 0;

  let previousInterval = -1;
  let movement: ScreenedPoint[] | null = null;
  let onPitch: PitchSample[] | null = null;
  let previousValid: ScreenedPoint | null = null;

  for (const point of screen.points) {
    const intervalIndex = intervalIndexAt(sorted, point.t);
    if (intervalIndex < 0) {
      counts.outsideIntervals += 1;
      continue;
    }
    screenedInIntervals += 1;
    if (point.excluded) {
      screenedExcluded += 1;
      exclude(point.excluded);
      continue;
    }
    counts.valid += 1;

    // A new movement run at every recorded break, interval boundary or gap.
    const startsRun =
      !movement ||
      intervalIndex !== previousInterval ||
      Boolean(point.breakBefore) ||
      (previousValid !== null && point.t - previousValid.t > screen.gapMs);
    if (startsRun) {
      movement = [];
      movementRuns.push(movement);
      runInterval.push(intervalIndex);
      onPitch = null;
    }
    movement!.push(point);
    previousInterval = intervalIndex;
    previousValid = point;

    let pitchPoint = transform.toPitch(point);
    if (sorted[intervalIndex].switchedEnds) pitchPoint = { x: pitch.length - pitchPoint.x, y: pitch.width - pitchPoint.y };
    const where = placement(pitchPoint, pitch, options.nearToleranceM);
    preview.push({ x: pitchPoint.x, y: pitchPoint.y, placement: where, breakBefore: startsRun || !onPitch });

    if (where === "off") {
      exclude("off-pitch");
      onPitch = null;
      continue;
    }
    if (where === "in") counts.inBounds += 1;
    else counts.nearLines += 1;
    if (!onPitch) {
      onPitch = [];
      pitchRuns.push(onPitch);
    }
    onPitch.push({ t: point.t, x: pitchPoint.x, y: pitchPoint.y });
  }

  const grid = buildHeatGrid(pitchRuns, pitch, options);
  const playingMs = playingTimeMs(sorted, activity);
  const metrics = computeMetrics({
    runs: movementRuns,
    runInterval,
    intervals: sorted,
    playingMs,
    heartRate: activity.heartRate,
    medianSamplingMs: screen.sampling.medianMs,
  });
  const trackedMs = (metrics.trackedTime.value ?? 0) * 1000;
  const onPitchMs = grid.totalSeconds * 1000;
  const quality = classifyQuality({
    countedSamples: counts.inBounds + counts.nearLines,
    onPitchMs,
    trackedMs,
    playingMs,
    medianSamplingMs: screen.sampling.medianMs,
    excludedShare: screenedInIntervals ? screenedExcluded / screenedInIntervals : 0,
    accuracyMedianM: screen.accuracy.medianM,
    calibrationRmsM: transform.fit.rms,
    cornersEstimated: calibration.cornerSource === "estimated",
  });

  return {
    algorithmVersion: ALGORITHM_VERSION,
    heatmapOptions: options,
    pitch,
    calibration,
    calibrationFit: {
      rms: transform.fit.rms,
      residuals: transform.fit.residuals,
      measuredSides: transform.fit.measuredSides,
      attackBearing: transform.fit.attackBearing,
    },
    intervals: sorted,
    grid,
    counts,
    quality,
    metrics,
    zones: gridZoneShares(grid, pitch),
    diagnostics: {
      medianSamplingMs: screen.sampling.medianMs,
      gapCount: screen.gaps.filter((gap) => intervalIndexAt(sorted, gap.end) >= 0).length,
      gapThresholdMs: screen.gapMs,
      playingMs,
      trackedMs,
      onPitchMs,
      accuracyMedianM: screen.accuracy.medianM,
    },
    preview: decimate(preview, PREVIEW_POINT_LIMIT, (point) => point.breakBefore),
  };
}

export interface ActivityOverview {
  metrics: MatchMetrics;
  warnings: string[];
  durationMs: number;
}

/**
 * A first look at a recording before anything is trimmed or calibrated:
 * whole-recording metrics and the issues screening found. Nothing here is
 * saved.
 */
export function summariseActivity(activity: NormalisedActivity, screen: ScreenResult): ActivityOverview {
  const runs: ScreenedPoint[][] = [];
  let run: ScreenedPoint[] | null = null;
  let previous: ScreenedPoint | null = null;
  for (const point of screen.points) {
    if (point.excluded) continue;
    if (!run || point.breakBefore || (previous && point.t - previous.t > screen.gapMs)) {
      run = [];
      runs.push(run);
    }
    run.push(point);
    previous = point;
  }
  const durationMs = activity.endTime - activity.startTime;
  const metrics = computeMetrics({
    runs,
    runInterval: runs.map(() => 0),
    intervals: [{ start: activity.startTime, end: activity.endTime }],
    playingMs: durationMs,
    heartRate: activity.heartRate,
    medianSamplingMs: screen.sampling.medianMs,
  });

  const warnings: string[] = [];
  if (screen.sampling.medianMs > 2000) {
    warnings.push(`Positions were recorded about every ${Math.round(screen.sampling.medianMs / 1000)} s. Every-second recording gives a sharper heatmap.`);
  } else if (screen.sampling.irregular) {
    warnings.push("Sampling was uneven: some stretches were recorded less often than others.");
  }
  if (screen.gaps.length) {
    const total = screen.gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0);
    warnings.push(`${screen.gaps.length} ${screen.gaps.length === 1 ? "gap" : "gaps"} in the recording (${Math.round(total / 60_000)} min in total). Gaps are never counted as standing still.`);
  }
  const excluded = Object.values(screen.excluded).reduce((sum, count) => sum + (count ?? 0), 0);
  if (excluded) warnings.push(`${excluded} of ${screen.points.length} points look like GPS errors and will be left out.`);
  const skipped = Object.values(activity.skipped).reduce((sum, count) => sum + (count ?? 0), 0);
  if (skipped) warnings.push(`${skipped} records in the file had no usable position or time and were skipped.`);
  if (!screen.accuracy.reported) warnings.push("The file has no accuracy information, so expect positions to be off by several metres.");
  warnings.push(...activity.provenance.notes);
  return { metrics, warnings, durationMs };
}
