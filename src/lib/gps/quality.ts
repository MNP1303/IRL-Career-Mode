/**
 * Recording quality: Usable, Approximate (shown with a warning) or
 * Insufficient (no heatmap; the player is offered manual zones instead).
 *
 * The thresholds are deliberately simple, documented and unit tested. They
 * judge the processed recording (after trimming and calibration), because a
 * clean file can still be unusable once warm-ups are trimmed away or most of
 * it lies off the calibrated pitch.
 */

export type QualityLevel = "usable" | "approximate" | "insufficient";

export const QUALITY_RULES = {
  /** Fewest on-pitch positions for any heatmap. */
  minCountedSamples: 60,
  /** Least on-pitch tracked time for any heatmap, and for a usable one. */
  minOnPitchMs: 5 * 60_000,
  usableOnPitchMs: 15 * 60_000,
  /** Share of playing time covered by trusted samples. */
  minCoverage: 0.5,
  usableCoverage: 0.85,
  /** Share of tracked time spent on or near the pitch. */
  minOnPitchShare: 0.4,
  usableOnPitchShare: 0.8,
  /** Typical gap between samples. */
  maxSamplingMs: 10_000,
  usableSamplingMs: 2_000,
  /** Share of samples in playing intervals that screening excluded. */
  usableExcludedShare: 0.1,
  /** Median device-reported accuracy, when reported. */
  usableAccuracyM: 10,
  /** Calibration residual (RMS) above which positions are approximate. */
  usableCalibrationRmsM: 3,
} as const;

/** Watch GPS is accurate to several metres; every GPS heatmap says so. */
export const GPS_ACCURACY_NOTE =
  "Watch and phone GPS is typically accurate to about 3–10 metres, and worse near tall stands, trees or buildings. Treat positions as approximate: good for where you spent your time, not for exact lines or touches.";

export interface QualityInputs {
  countedSamples: number;
  onPitchMs: number;
  trackedMs: number;
  playingMs: number;
  medianSamplingMs: number;
  excludedShare: number;
  accuracyMedianM: number | null;
  calibrationRmsM: number;
  cornersEstimated: boolean;
}

export interface QualityReason {
  severity: "insufficient" | "approximate";
  message: string;
}

export interface QualityReport {
  level: QualityLevel;
  reasons: QualityReason[];
  notes: string[];
  coverage: number;
  onPitchShare: number;
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;
const percent = (share: number) => `${Math.round(share * 100)}%`;

export function classifyQuality(input: QualityInputs): QualityReport {
  const rules = QUALITY_RULES;
  const coverage = input.playingMs > 0 ? Math.min(1, input.trackedMs / input.playingMs) : 0;
  const onPitchShare = input.trackedMs > 0 ? input.onPitchMs / input.trackedMs : 0;
  const reasons: QualityReason[] = [];
  const insufficient = (message: string) => reasons.push({ severity: "insufficient", message });
  const approximate = (message: string) => reasons.push({ severity: "approximate", message });

  if (input.countedSamples < rules.minCountedSamples) {
    insufficient(`Only ${input.countedSamples} positions fall on the pitch; a heatmap needs at least ${rules.minCountedSamples}.`);
  }
  if (input.onPitchMs < rules.minOnPitchMs) {
    insufficient(`Only ${minutes(input.onPitchMs)} of tracked time on the pitch; a heatmap needs at least ${minutes(rules.minOnPitchMs)}.`);
  } else if (input.onPitchMs < rules.usableOnPitchMs) {
    approximate(`Only ${minutes(input.onPitchMs)} on the pitch, so the heatmap reflects a short spell.`);
  }
  if (coverage < rules.minCoverage) {
    insufficient(`GPS covers only ${percent(coverage)} of your playing time.`);
  } else if (coverage < rules.usableCoverage) {
    approximate(`GPS covers ${percent(coverage)} of your playing time; the rest had gaps.`);
  }
  if (input.trackedMs > 0 && onPitchShare < rules.minOnPitchShare) {
    insufficient(`Only ${percent(onPitchShare)} of the tracked time is on the calibrated pitch. Check the corners or your playing intervals.`);
  } else if (input.trackedMs > 0 && onPitchShare < rules.usableOnPitchShare) {
    approximate(`${percent(1 - onPitchShare)} of the tracked time is well outside the pitch and was left out.`);
  }
  if (input.medianSamplingMs > rules.maxSamplingMs) {
    insufficient(`The device recorded a position only every ${Math.round(input.medianSamplingMs / 1000)} s.`);
  } else if (input.medianSamplingMs > rules.usableSamplingMs) {
    approximate(`The device recorded a position about every ${Math.round(input.medianSamplingMs / 1000)} s ("smart recording"). Every-second recording gives a sharper map.`);
  }
  if (input.excludedShare > rules.usableExcludedShare) {
    approximate(`${percent(input.excludedShare)} of samples were excluded as GPS errors.`);
  }
  if (input.accuracyMedianM !== null && input.accuracyMedianM > rules.usableAccuracyM) {
    approximate(`The device reported a typical accuracy of ${Math.round(input.accuracyMedianM)} m.`);
  }
  if (input.cornersEstimated) {
    approximate("The pitch corners were estimated from your movement, not placed on the real pitch.");
  } else if (input.calibrationRmsM > rules.usableCalibrationRmsM) {
    approximate(`The corners are up to ${input.calibrationRmsM.toFixed(1)} m from the pitch size you entered.`);
  }

  const notes = [GPS_ACCURACY_NOTE];
  if (input.accuracyMedianM === null) notes.push("This file has no accuracy information, so accuracy couldn't be checked point by point.");

  const level: QualityLevel = reasons.some((reason) => reason.severity === "insufficient")
    ? "insufficient"
    : reasons.length
      ? "approximate"
      : "usable";
  return { level, reasons, notes, coverage, onPitchShare };
}

export const QUALITY_META: Record<QualityLevel, { label: string; description: string }> = {
  usable: { label: "Usable", description: "Good enough for a reliable heatmap, within normal GPS accuracy." },
  approximate: { label: "Approximate", description: "Shown with a warning: read it as a rough picture." },
  insufficient: { label: "Insufficient", description: "Not enough reliable data for a heatmap." },
};
