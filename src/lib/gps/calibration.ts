/**
 * Pitch calibration: turns latitude/longitude into pitch metres.
 *
 * 1. The four measured corners and every GPS point are projected into a
 *    local east/north plane (metres) centred on the corners.
 * 2. A rectangle of the player's stated length and width is fitted to the
 *    corners with a rigid transform: rotation and translation only, with the
 *    fixed reflection the pitch axes need. It never scales or shears, so
 *    distances and angles survive exactly.
 * 3. If the measured corners don't match the stated size, the fit reports
 *    how far off each corner is instead of stretching to fit.
 *
 * Activity extents (min/max coordinates) are never used to place the pitch.
 *
 * Corner order follows `PitchPoint` (see `types.ts`):
 *   0: own goal line × left touchline   (x = 0,      y = 0)
 *   1: opposition goal line × left       (x = length, y = 0)
 *   2: opposition goal line × right      (x = length, y = width)
 *   3: own goal line × right touchline   (x = 0,      y = width)
 * "Left" is the left touchline when facing the opposition goal.
 */

import { localProjection, type LocalProjection } from "@/lib/gps/geo";
import type { LatLon, PitchDimensions, PitchPoint } from "@/lib/gps/types";

export const CALIBRATION_VERSION = 1;

export const PITCH_PRESETS = {
  "5v5": { label: "5-a-side", length: 40, width: 20 },
  "7v7": { label: "7-a-side", length: 60, width: 40 },
  "11v11": { label: "11-a-side", length: 105, width: 68 },
} as const;
export type PitchPreset = keyof typeof PITCH_PRESETS | "custom";

export const DIMENSION_LIMITS = { minLength: 15, maxLength: 130, minWidth: 10, maxWidth: 100 } as const;

/** Residual (RMS, metres) above which the corners and dimensions are flagged as inconsistent. */
export const WARN_RESIDUAL_M = 3;
/** Residual above which the calibration is refused: the size or corners are clearly wrong. */
export const MAX_RESIDUAL_M = 10;

export const CORNER_LABELS = [
  "Your goal line, left corner",
  "Their goal line, left corner",
  "Their goal line, right corner",
  "Your goal line, right corner",
] as const;

export type Corners = [LatLon, LatLon, LatLon, LatLon];

export interface PitchCalibration {
  version: typeof CALIBRATION_VERSION;
  corners: Corners;
  length: number;
  width: number;
  preset: PitchPreset;
  /**
   * How the corners were set: placed on the route, typed in from a map,
   * loaded from a saved calibration, or estimated from movement (least
   * trustworthy; the heatmap is marked approximate).
   */
  cornerSource: "placed" | "entered" | "saved" | "estimated";
}

export type CalibrationIssueCode =
  | "dimensions-out-of-range"
  | "corners-too-close"
  | "self-intersecting"
  | "not-convex"
  | "mirrored"
  | "inconsistent-size"
  | "size-mismatch";

export interface CalibrationIssue {
  code: CalibrationIssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface CalibrationFit {
  ok: boolean;
  issues: CalibrationIssue[];
  /** Rotation of the pitch's x axis from east, anticlockwise, in radians. */
  rotation: number;
  /** Bearing the attack runs towards, in degrees clockwise from north. */
  attackBearing: number;
  /** Distance from each measured corner to the fitted rectangle's corner, metres. */
  residuals: [number, number, number, number];
  rms: number;
  /** Measured side lengths: 0→1, 1→2, 2→3, 3→0 (metres). */
  measuredSides: [number, number, number, number];
  /** Interior angle at each corner, degrees. */
  measuredAngles: [number, number, number, number];
}

export interface PitchTransform {
  calibration: PitchCalibration;
  fit: CalibrationFit;
  toPitch(point: LatLon): PitchPoint;
  fromPitch(point: PitchPoint): LatLon;
  projection: LocalProjection;
}

type Vec = { x: number; y: number };

const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const length = (a: Vec) => Math.hypot(a.x, a.y);

function segmentsIntersect(p1: Vec, p2: Vec, q1: Vec, q2: Vec) {
  const d1 = cross(sub(q2, q1), sub(p1, q1));
  const d2 = cross(sub(q2, q1), sub(p2, q1));
  const d3 = cross(sub(p2, p1), sub(q1, p1));
  const d4 = cross(sub(p2, p1), sub(q2, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function cornerCentre(corners: Corners): LatLon {
  return {
    lat: corners.reduce((sum, corner) => sum + corner.lat, 0) / 4,
    lon: corners.reduce((sum, corner) => sum + corner.lon, 0) / 4,
  };
}

/** The model rectangle's corners in pitch metres, in corner order. */
export function modelCorners({ length: L, width: W }: PitchDimensions): [PitchPoint, PitchPoint, PitchPoint, PitchPoint] {
  return [
    { x: 0, y: 0 },
    { x: L, y: 0 },
    { x: L, y: W },
    { x: 0, y: W },
  ];
}

export function checkDimensions({ length: L, width: W }: PitchDimensions): CalibrationIssue[] {
  const { minLength, maxLength, minWidth, maxWidth } = DIMENSION_LIMITS;
  if (!Number.isFinite(L) || !Number.isFinite(W) || L < minLength || L > maxLength || W < minWidth || W > maxWidth) {
    return [
      {
        code: "dimensions-out-of-range",
        severity: "error",
        message: `Use a length of ${minLength}–${maxLength} m and a width of ${minWidth}–${maxWidth} m.`,
      },
    ];
  }
  return [];
}

/**
 * Fits the stated rectangle to the measured corners.
 *
 * The pitch frame (x forward, y towards the right touchline) is a mirror
 * image of east/north, so the model is reflected once (y → −y) and then
 * only rotated and translated. With the model corners q and measured
 * corners m, both centred, the least-squares rotation is
 *   θ = atan2(Σ q × m, Σ q · m)
 * and the translation is the difference of the centroids.
 */
export function fitCalibration(calibration: PitchCalibration): { fit: CalibrationFit; projection: LocalProjection; theta: number; translation: Vec } {
  const projection = localProjection(cornerCentre(calibration.corners));
  const measured = calibration.corners.map((corner) => {
    const { e, n } = projection.forward(corner);
    return { x: e, y: n };
  });
  const model = modelCorners(calibration).map((point) => ({ x: point.x, y: -point.y }));

  const centroid = (points: Vec[]) => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  });
  const mc = centroid(measured);
  const qc = centroid(model);
  let sumCross = 0;
  let sumDot = 0;
  for (let index = 0; index < 4; index += 1) {
    const q = sub(model[index], qc);
    const m = sub(measured[index], mc);
    sumCross += cross(q, m);
    sumDot += q.x * m.x + q.y * m.y;
  }
  const theta = Math.atan2(sumCross, sumDot);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const rotate = (v: Vec): Vec => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos });
  const rotatedCentroid = rotate(qc);
  const translation = { x: mc.x - rotatedCentroid.x, y: mc.y - rotatedCentroid.y };

  const residuals = model.map((q, index) => {
    const placed = rotate(q);
    return Math.hypot(placed.x + translation.x - measured[index].x, placed.y + translation.y - measured[index].y);
  }) as CalibrationFit["residuals"];
  const rms = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / 4);

  const measuredSides = [0, 1, 2, 3].map((index) => length(sub(measured[(index + 1) % 4], measured[index]))) as CalibrationFit["measuredSides"];
  const measuredAngles = [0, 1, 2, 3].map((index) => {
    const previous = sub(measured[(index + 3) % 4], measured[index]);
    const next = sub(measured[(index + 1) % 4], measured[index]);
    const cosine = (previous.x * next.x + previous.y * next.y) / (length(previous) * length(next) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  }) as CalibrationFit["measuredAngles"];

  const issues: CalibrationIssue[] = [...checkDimensions(calibration)];

  const minSeparation = Math.min(
    ...measured.flatMap((a, i) => measured.slice(i + 1).map((b) => length(sub(a, b)))),
  );
  if (minSeparation < 5) {
    issues.push({ code: "corners-too-close", severity: "error", message: "Two corners are less than 5 m apart. Place each corner on a different corner of the pitch." });
  }
  if (segmentsIntersect(measured[0], measured[1], measured[2], measured[3]) || segmentsIntersect(measured[1], measured[2], measured[3], measured[0])) {
    issues.push({
      code: "self-intersecting",
      severity: "error",
      message: "The corners cross over each other. Place them in order around the pitch.",
    });
  } else {
    const turns = [0, 1, 2, 3].map((index) =>
      cross(sub(measured[(index + 1) % 4], measured[index]), sub(measured[(index + 2) % 4], measured[(index + 1) % 4])),
    );
    const allNegative = turns.every((turn) => turn < 0);
    const allPositive = turns.every((turn) => turn > 0);
    if (!allNegative && !allPositive) {
      issues.push({ code: "not-convex", severity: "error", message: "The corners don't form a rectangle-like shape. Check each one." });
    } else if (allPositive) {
      // The pitch frame is mirrored relative to east/north, so a correct order runs clockwise on a map.
      issues.push({
        code: "mirrored",
        severity: "error",
        message: "Left and right look swapped: the corners run the wrong way round. Use “Swap left and right”.",
      });
    }
  }

  if (!issues.some((issue) => issue.severity === "error")) {
    if (rms > MAX_RESIDUAL_M) {
      issues.push({
        code: "size-mismatch",
        severity: "error",
        message: `The corners measure about ${Math.round((measuredSides[0] + measuredSides[2]) / 2)} × ${Math.round((measuredSides[1] + measuredSides[3]) / 2)} m, which doesn't match ${calibration.length} × ${calibration.width} m. Check the size or the corners.`,
      });
    } else if (rms > WARN_RESIDUAL_M) {
      issues.push({
        code: "inconsistent-size",
        severity: "warning",
        message: `The corners are up to ${Math.max(...residuals).toFixed(1)} m from a ${calibration.length} × ${calibration.width} m rectangle. The pitch isn't stretched to fit, so check the size or the corners.`,
      });
    }
  }

  // The attack runs along the pitch x axis, which the rotation puts at θ from east.
  const attackBearing = ((90 - (theta * 180) / Math.PI) % 360 + 360) % 360;
  return {
    fit: {
      ok: !issues.some((issue) => issue.severity === "error"),
      issues,
      rotation: theta,
      attackBearing,
      residuals,
      rms,
      measuredSides,
      measuredAngles,
    },
    projection,
    theta,
    translation,
  };
}

export function createTransform(calibration: PitchCalibration): PitchTransform {
  const { fit, projection, theta, translation } = fitCalibration(calibration);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    calibration,
    fit,
    projection,
    toPitch(point) {
      const { e, n } = projection.forward(point);
      const dx = e - translation.x;
      const dy = n - translation.y;
      // Undo the rotation, then the reflection.
      return { x: dx * cos + dy * sin, y: -(-dx * sin + dy * cos) };
    },
    fromPitch(point) {
      const qx = point.x;
      const qy = -point.y;
      return projection.inverse(qx * cos - qy * sin + translation.x, qx * sin + qy * cos + translation.y);
    },
  };
}

/** The same pitch with the attacking direction reversed (corners turned through 180°). */
export function reverseAttack(calibration: PitchCalibration): PitchCalibration {
  const [a, b, c, d] = calibration.corners;
  return { ...calibration, corners: [c, d, a, b] };
}

/** The same pitch with left and right exchanged, fixing a mirrored corner order. */
export function swapSides(calibration: PitchCalibration): PitchCalibration {
  const [a, b, c, d] = calibration.corners;
  return { ...calibration, corners: [d, c, b, a] };
}

/**
 * A starting guess when the player has no corners: a rectangle of the stated
 * size, centred on where they spent their time and turned along the main
 * direction of their movement. It is rigid (never stretched to the route) and
 * marked `estimated`, so the heatmap is labelled approximate until the player
 * moves the corners onto the real pitch.
 */
export function estimateCorners(points: LatLon[], dimensions: PitchDimensions): Corners | null {
  if (points.length < 10) return null;
  const centre = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
  };
  const projection = localProjection(centre);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const { e, n } = projection.forward(point);
    sxx += e * e;
    syy += n * n;
    sxy += e * n;
  }
  // Principal axis of the positions.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfL = dimensions.length / 2;
  const halfW = dimensions.width / 2;
  return modelCorners(dimensions).map((corner) => {
    const qx = corner.x - halfL;
    const qy = -(corner.y - halfW);
    return projection.inverse(qx * cos - qy * sin, qx * sin + qy * cos);
  }) as Corners;
}

export interface CompatibilityCheck {
  compatible: boolean;
  distanceM: number;
  insideShare: number;
  message: string;
}

/**
 * Whether a saved calibration plausibly belongs to this activity: its pitch
 * must be near where the activity was recorded, and a fair share of the
 * recording must fall on or near it.
 */
export function checkCompatibility(calibration: PitchCalibration, points: LatLon[], toleranceM = 5): CompatibilityCheck {
  const transform = createTransform(calibration);
  const centre = cornerCentre(calibration.corners);
  const activityCentre = points.length
    ? { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lon: points.reduce((s, p) => s + p.lon, 0) / points.length }
    : centre;
  const { e, n } = transform.projection.forward(activityCentre);
  const distanceM = Math.hypot(e, n);
  let inside = 0;
  for (const point of points) {
    const p = transform.toPitch(point);
    if (p.x >= -toleranceM && p.x <= calibration.length + toleranceM && p.y >= -toleranceM && p.y <= calibration.width + toleranceM) inside += 1;
  }
  const insideShare = points.length ? inside / points.length : 0;
  if (distanceM > 1000) {
    return { compatible: false, distanceM, insideShare, message: `This pitch is ${(distanceM / 1000).toFixed(1)} km from where the activity was recorded.` };
  }
  if (insideShare < 0.2) {
    return { compatible: false, distanceM, insideShare, message: `Only ${Math.round(insideShare * 100)}% of the recording falls on this pitch.` };
  }
  return { compatible: true, distanceM, insideShare, message: `${Math.round(insideShare * 100)}% of the recording falls on or near this pitch.` };
}
