import { PITCH_PRESETS, type PitchCalibration, type PitchPreset } from "@/lib/gps/calibration";
import type { TrackingResult } from "@/lib/gps/pipeline";
import type { PendingImport, DuplicateReport } from "@/lib/gps/service";
import { detectPitch, type PitchDetection } from "@/lib/gps/detect";
import { checkIntervals, type PlayingInterval } from "@/lib/gps/trim";
import type { LatLon } from "@/lib/gps/types";
import type { ParsedFile } from "@/lib/gps/worker-protocol";
import type { MatchFormat, Position } from "@/lib/domain";
import type { Match } from "@/lib/schema";

export const STEPS = [
  { id: "file", label: "File" },
  { id: "preview", label: "Preview" },
  { id: "trim", label: "Trim" },
  { id: "calibrate", label: "Pitch" },
  { id: "heatmap", label: "Heatmap" },
  { id: "attach", label: "Attach" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export type WizardTarget =
  | { kind: "existing"; match: Match; hasTrack: boolean }
  | { kind: "new"; format: MatchFormat; date: string; position: Position };

/** A processed import waiting for its match to be saved (logging a new match). */
export interface PendingGpsAttachment {
  pending: PendingImport;
  result: TrackingResult;
  calibrationId: string | null;
}

export interface CalibrationDraft {
  preset: PitchPreset;
  length: number;
  width: number;
  corners: (LatLon | null)[];
  cornerSource: PitchCalibration["cornerSource"];
  /** Saved calibration this draft came from, if any (cleared on edit). */
  savedId: string | null;
}

export function presetForFormat(format: MatchFormat): PitchPreset {
  return format;
}

export function draftFromPreset(preset: PitchPreset): CalibrationDraft {
  const size = preset === "custom" ? PITCH_PRESETS["11v11"] : PITCH_PRESETS[preset];
  return { preset, length: size.length, width: size.width, corners: [null, null, null, null], cornerSource: "placed", savedId: null };
}

export function draftFromCalibration(calibration: PitchCalibration, savedId: string | null = null): CalibrationDraft {
  return {
    preset: calibration.preset,
    length: calibration.length,
    width: calibration.width,
    corners: [...calibration.corners],
    cornerSource: calibration.cornerSource,
    savedId,
  };
}

/** The draft as a calibration, once all four corners are set. */
export function toCalibration(draft: CalibrationDraft): PitchCalibration | null {
  if (draft.corners.some((corner) => !corner)) return null;
  return {
    version: 1,
    corners: draft.corners as PitchCalibration["corners"],
    length: draft.length,
    width: draft.width,
    preset: draft.preset,
    cornerSource: draft.cornerSource,
  };
}

export interface LoadedFile {
  bytes: Uint8Array;
  name: string | null;
  parsed: ParsedFile;
}

/** Trusted positions inside the playing intervals, thinned to at most about `limit`. */
export function playingPoints(parsed: ParsedFile, intervals: PlayingInterval[], limit = 4000) {
  const sorted = checkIntervals(intervals, parsed.activity).intervals;
  const points = parsed.screen.points.filter((point) => !point.excluded && sorted.some((interval) => point.t >= interval.start && point.t <= interval.end));
  const stride = Math.max(1, Math.floor(points.length / limit));
  return points.filter((_, index) => index % stride === 0);
}

/** Places the pitch from the movement (see `detect.ts`), as a draft the player then checks. */
export function detectDraft(parsed: ParsedFile, intervals: PlayingInterval[], draft: CalibrationDraft, position: Position | null): { draft: CalibrationDraft; detection: PitchDetection } | null {
  const sorted = checkIntervals(intervals, parsed.activity).intervals;
  const detection = detectPitch(playingPoints(parsed, intervals), draft, {
    position,
    switchedIntervals: sorted.filter((interval) => interval.switchedEnds),
  });
  if (!detection) return null;
  return { draft: { ...draft, corners: [...detection.corners], cornerSource: "estimated", savedId: null }, detection };
}

export type { DuplicateReport, PitchDetection, PlayingInterval };
