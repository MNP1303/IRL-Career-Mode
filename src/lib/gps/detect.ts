/**
 * Finds the pitch from the movement alone, as a starting point the player
 * checks and adjusts. No map data or network lookups are used.
 *
 * The pitch is always a rigid rectangle of the stated size, so detection is a
 * search over its rotation and position:
 *
 * 1. Time weighting: each position counts for the time until the next one
 *    (capped), so a watch sampling faster in some spells doesn't pull the
 *    pitch towards them.
 * 2. Rotation: for every candidate angle the positions are binned on a 1 m
 *    grid, and a summed-area table finds the placement of the pitch that
 *    holds the most playing time (players spend almost all of it inside the
 *    lines). Ties, which are common when someone only covers part of the
 *    pitch, are broken by running direction: football runs mostly follow the
 *    pitch axes, and most often its length.
 * 3. Position: of the placements that hold (nearly) all the time, the one
 *    chosen puts the player's average position where their role usually
 *    plays (a centre back near their own goal, a left winger high on the
 *    left), which also decides the attacking direction. Without a role, the
 *    pitch is centred on the movement and the attack direction is a guess the
 *    player is asked to check.
 *
 * The result says how sure it is and why, and is always marked `estimated`
 * so the heatmap is labelled approximate until the player confirms it.
 */

import { reverseAttack, PITCH_PRESETS, type Corners } from "@/lib/gps/calibration";
import { localProjection, median } from "@/lib/gps/geo";
import type { LatLon, PitchDimensions } from "@/lib/gps/types";
import { PITCH, POSITION_META, type Position } from "@/lib/domain";

export interface DetectPoint extends LatLon {
  t: number;
}

export interface DetectOptions {
  /** The role played, if known: places the movement on the pitch and sets the attack direction. */
  position?: Position | null;
  /** Spells after switching ends (their positions are mirrored, so they don't inform the role placement). */
  switchedIntervals?: { start: number; end: number }[];
}

export type DetectionConfidence = "high" | "medium" | "low";

export interface PitchDetection {
  corners: Corners;
  confidence: DetectionConfidence;
  /** Share of playing time on the detected pitch, allowing for normal GPS error at the lines. */
  insideShare: number;
  /** How far the movement spreads along the detected length and width (2nd–98th percentile), metres. */
  footprint: { length: number; width: number };
  /** Whether the attacking direction came from the role (otherwise it's a guess). */
  attackFromRole: boolean;
  /**
   * When the movement can't show which way the player attacked: the pitch for
   * the other direction. With a role it sits elsewhere (the role is placed
   * the other way round), so it isn't simply `corners` reversed. The player
   * picks between the two by the compass direction they attacked.
   */
  alternative: Corners | null;
  /** A preset that fits the movement much better than the stated size, if there is one. */
  suggestedPreset: keyof typeof PITCH_PRESETS | null;
  /** Plain-language notes for the player, most important first. */
  notes: string[];
}

/** GPS error allowed at the lines when counting time on the pitch. */
const TOLERANCE_M = 3;
const MIN_POINTS = 30;
/** Placements within this share of the best are treated as equally good. */
const TIE_SHARE = 0.005;

interface Local {
  e: number;
  n: number;
  w: number;
  roleUsable: boolean;
}

interface Raster {
  theta: number;
  originU: number;
  originV: number;
  nu: number;
  nv: number;
  /** Summed-area table, (nu + 1) × (nv + 1). */
  sat: Float64Array;
}

function weightedMedian(values: number[], weights: number[]) {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const half = weights.reduce((sum, w) => sum + w, 0) / 2;
  let running = 0;
  for (const index of order) {
    running += weights[index];
    if (running >= half) return values[index];
  }
  return values[order.at(-1)!];
}

function weightedQuantile(values: number[], weights: number[], q: number) {
  const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
  const target = weights.reduce((sum, w) => sum + w, 0) * q;
  let running = 0;
  for (const index of order) {
    running += weights[index];
    if (running >= target) return values[index];
  }
  return values[order.at(-1)!];
}

/** Seconds each position stands for: the time to the next one, capped so gaps and breaks don't count. */
function timeWeights(points: DetectPoint[]) {
  const gaps = points.slice(1).map((point, index) => (point.t - points[index].t) / 1000);
  const typical = median(gaps.filter((gap) => gap > 0)) || 1;
  const cap = Math.max(10, typical * 3);
  return points.map((_, index) => {
    const gap = index < gaps.length ? gaps[index] : typical;
    return Math.max(0, Math.min(gap, cap));
  });
}

function rasterise(points: Local[], theta: number, padU: number, padV: number): Raster {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const u = new Float64Array(points.length);
  const v = new Float64Array(points.length);
  points.forEach((point, index) => {
    u[index] = point.e * cos + point.n * sin;
    v[index] = -point.e * sin + point.n * cos;
    minU = Math.min(minU, u[index]);
    maxU = Math.max(maxU, u[index]);
    minV = Math.min(minV, v[index]);
    maxV = Math.max(maxV, v[index]);
  });
  // Padding by a window's size lets the window slide fully past the movement on every side.
  const originU = Math.floor(minU) - padU;
  const originV = Math.floor(minV) - padV;
  const nu = Math.ceil(maxU) + padU - originU + 1;
  const nv = Math.ceil(maxV) + padV - originV + 1;
  const sat = new Float64Array((nu + 1) * (nv + 1));
  const stride = nv + 1;
  points.forEach((point, index) => {
    const i = Math.min(nu - 1, Math.floor(u[index] - originU));
    const j = Math.min(nv - 1, Math.floor(v[index] - originV));
    sat[(i + 1) * stride + (j + 1)] += point.w;
  });
  for (let i = 1; i <= nu; i += 1) {
    for (let j = 1; j <= nv; j += 1) {
      sat[i * stride + j] += sat[(i - 1) * stride + j] + sat[i * stride + (j - 1)] - sat[(i - 1) * stride + (j - 1)];
    }
  }
  return { theta, originU, originV, nu, nv, sat };
}

/** Time inside a wu × wv window starting at bin (i, j). */
function windowSum(raster: Raster, i: number, j: number, wu: number, wv: number) {
  const stride = raster.nv + 1;
  const { sat } = raster;
  return sat[(i + wu) * stride + (j + wv)] - sat[i * stride + (j + wv)] - sat[(i + wu) * stride + j] + sat[i * stride + j];
}

function windowSize(dimensions: PitchDimensions) {
  return { wu: Math.round(dimensions.length + TOLERANCE_M * 2), wv: Math.round(dimensions.width + TOLERANCE_M * 2) };
}

function bestWindow(raster: Raster, dimensions: PitchDimensions) {
  const { wu, wv } = windowSize(dimensions);
  let best = -1;
  for (let i = 0; i + wu <= raster.nu; i += 1) {
    for (let j = 0; j + wv <= raster.nv; j += 1) {
      const sum = windowSum(raster, i, j, wu, wv);
      if (sum > best) best = sum;
    }
  }
  return best;
}

/**
 * Of the windows holding (nearly) the most time, the one whose pitch origin
 * (u0, v0, in metres) is closest to the target. Returns that origin and how
 * far it had to move from the target.
 */
function nearestGoodWindow(raster: Raster, dimensions: PitchDimensions, best: number, total: number, target: { u0: number; v0: number }) {
  const { wu, wv } = windowSize(dimensions);
  const floor = best - TIE_SHARE * total;
  let chosen = { u0: target.u0, v0: target.v0, cost: Infinity };
  for (let i = 0; i + wu <= raster.nu; i += 1) {
    for (let j = 0; j + wv <= raster.nv; j += 1) {
      if (windowSum(raster, i, j, wu, wv) < floor) continue;
      const u0 = raster.originU + i + TOLERANCE_M;
      const v0 = raster.originV + j + TOLERANCE_M;
      const cost = Math.hypot(u0 - target.u0, v0 - target.v0);
      if (cost < chosen.cost) chosen = { u0, v0, cost };
    }
  }
  return chosen;
}

export function detectPitch(input: DetectPoint[], dimensions: PitchDimensions, options: DetectOptions = {}): PitchDetection | null {
  const sorted = [...input].sort((a, b) => a.t - b.t);
  if (sorted.length < MIN_POINTS) return null;
  const weights = timeWeights(sorted);
  const centre = {
    lat: weightedMedian(sorted.map((point) => point.lat), weights),
    lon: weightedMedian(sorted.map((point) => point.lon), weights),
  };
  const projection = localProjection(centre);
  const switched = options.switchedIntervals ?? [];
  const reach = Math.hypot(dimensions.length, dimensions.width);

  // Positions further from the middle of the play than a pitch diagonal can't be on it (a walk to the bench, say).
  const kept: (Local & { t: number })[] = [];
  sorted.forEach((point, index) => {
    const { e, n } = projection.forward(point);
    if (Math.hypot(e, n) > reach || weights[index] <= 0) return;
    kept.push({ e, n, w: weights[index], t: point.t, roleUsable: !switched.some((spell) => point.t >= spell.start && point.t <= spell.end) });
  });
  if (kept.length < MIN_POINTS) return null;
  const total = kept.reduce((sum, point) => sum + point.w, 0);

  // Running directions, as doubled and quadrupled angles so opposite runs reinforce each other.
  let c2 = 0;
  let s2 = 0;
  let c4 = 0;
  let s4 = 0;
  let runWeight = 0;
  for (let index = 1; index < kept.length; index += 1) {
    const a = kept[index - 1];
    const b = kept[index];
    const dt = (b.t - a.t) / 1000;
    const distance = Math.hypot(b.e - a.e, b.n - a.n);
    if (dt <= 0 || dt > 6 || distance < 1) continue;
    const speed = distance / dt;
    if (speed < 2 || speed > 10) continue;
    const heading = Math.atan2(b.n - a.n, b.e - a.e);
    c2 += distance * Math.cos(2 * heading);
    s2 += distance * Math.sin(2 * heading);
    c4 += distance * Math.cos(4 * heading);
    s4 += distance * Math.sin(4 * heading);
    runWeight += distance;
  }
  const alignment = (theta: number) =>
    runWeight > 0 ? (0.04 * (c4 * Math.cos(4 * theta) + s4 * Math.sin(4 * theta)) + 0.02 * (c2 * Math.cos(2 * theta) + s2 * Math.sin(2 * theta))) / runWeight : 0;

  const { wu, wv } = windowSize(dimensions);
  const evaluate = (theta: number) => {
    const raster = rasterise(kept, theta, wu, wv);
    const best = bestWindow(raster, dimensions);
    return { theta, raster, best, score: best / total + alignment(theta) };
  };

  // Coarse sweep over half a turn (the other half is the same rectangle), then refine around the best.
  let top = evaluate(0);
  let worstShare = top.best / total;
  for (let degrees = 3; degrees < 180; degrees += 3) {
    const candidate = evaluate((degrees * Math.PI) / 180);
    worstShare = Math.min(worstShare, candidate.best / total);
    if (candidate.score > top.score) top = candidate;
  }
  const coarse = top.theta;
  for (let offset = -2.5; offset <= 2.5; offset += 0.5) {
    if (offset === 0) continue;
    const candidate = evaluate(coarse + (offset * Math.PI) / 180);
    if (candidate.score > top.score) top = candidate;
  }
  const { theta, raster, best } = top;
  const insideShare = best / total;
  // When the pitch holds the play at any angle, only running directions chose it, and only clear ones count.
  const runStrength = runWeight > 0 ? Math.hypot(c4, s4) / runWeight : 0;
  const angleUnsure = insideShare - worstShare < 0.02 && runStrength < 0.25;

  // The movement in the detected frame.
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const us = kept.map((point) => point.e * cos + point.n * sin);
  const vs = kept.map((point) => -point.e * sin + point.n * cos);
  const ws = kept.map((point) => point.w);
  const uLow = weightedQuantile(us, ws, 0.02);
  const uHigh = weightedQuantile(us, ws, 0.98);
  const vLow = weightedQuantile(vs, ws, 0.02);
  const vHigh = weightedQuantile(vs, ws, 0.98);
  const footprint = { length: uHigh - uLow, width: vHigh - vLow };

  // Pitch frame for an attack towards +u: x = u − u0, y = v0 + W − v. Towards −u it's turned through 180°.
  const { length: L, width: W } = dimensions;
  let placement: { u0: number; v0: number };
  let other: { u0: number; v0: number } | null = null;
  let flip = false;
  let attackFromRole = false;
  const roleMeta = options.position ? POSITION_META[options.position] : null;
  const rolePoints = kept.map((point, index) => ({ point, index })).filter(({ point }) => point.roleUsable);
  if (roleMeta && rolePoints.length >= MIN_POINTS) {
    const roleWeight = rolePoints.reduce((sum, { point }) => sum + point.w, 0);
    const meanU = rolePoints.reduce((sum, { point, index }) => sum + us[index] * point.w, 0) / roleWeight;
    const meanV = rolePoints.reduce((sum, { point, index }) => sum + vs[index] * point.w, 0) / roleWeight;
    const px = (roleMeta.x / PITCH.length) * L;
    const py = (roleMeta.y / PITCH.width) * W;
    const forward = nearestGoodWindow(raster, dimensions, best, total, { u0: meanU - px, v0: meanV - W + py });
    // Attacking towards −u: x = u0 + L − u and y = v − v0.
    const backward = nearestGoodWindow(raster, dimensions, best, total, { u0: meanU + px - L, v0: meanV - py });
    flip = backward.cost < forward.cost;
    placement = flip ? backward : forward;
    other = flip ? forward : backward;
    attackFromRole = Math.abs(backward.cost - forward.cost) > 8;
  } else {
    placement = nearestGoodWindow(raster, dimensions, best, total, { u0: (uLow + uHigh) / 2 - L / 2, v0: (vLow + vHigh) / 2 - W / 2 });
  }

  const toLatLon = (u: number, v: number) => projection.inverse(u * cos - v * sin, u * sin + v * cos);
  const cornersFor = ({ u0, v0 }: { u0: number; v0: number }, reversed: boolean): Corners => {
    const towardsU: Corners = [toLatLon(u0, v0 + W), toLatLon(u0 + L, v0 + W), toLatLon(u0 + L, v0), toLatLon(u0, v0)];
    return reversed ? reverseAttack({ version: 1, corners: towardsU, length: L, width: W, preset: "custom", cornerSource: "estimated" }).corners : towardsU;
  };
  const corners = cornersFor(placement, flip);
  const alternative = attackFromRole ? null : other ? cornersFor(other, !flip) : cornersFor(placement, !flip);

  // Would a standard size fit clearly better?
  let suggestedPreset: PitchDetection["suggestedPreset"] = null;
  if (insideShare < 0.9) {
    for (const key of Object.keys(PITCH_PRESETS) as (keyof typeof PITCH_PRESETS)[]) {
      const preset = PITCH_PRESETS[key];
      if (preset.length === L && preset.width === W) continue;
      const window = windowSize(preset);
      const share = bestWindow(rasterise(kept, theta, window.wu, window.wv), preset) / total;
      if (share >= 0.93 && share > insideShare + 0.05) {
        suggestedPreset = key;
        break;
      }
    }
  }

  const spansLength = footprint.length >= 0.7 * L;
  const spansWidth = footprint.width >= 0.6 * W;
  const confidence: DetectionConfidence = insideShare < 0.85 || angleUnsure ? "low" : insideShare >= 0.95 && spansLength && spansWidth ? "high" : "medium";

  const notes: string[] = [];
  const percentOff = Math.round((1 - insideShare) * 100);
  if (insideShare < 0.85) {
    notes.push(
      suggestedPreset
        ? `${percentOff}% of your playing time falls outside a ${L} × ${W} m pitch. A ${PITCH_PRESETS[suggestedPreset].label} pitch (${PITCH_PRESETS[suggestedPreset].length} × ${PITCH_PRESETS[suggestedPreset].width} m) fits much better.`
        : `${percentOff}% of your playing time falls outside a ${L} × ${W} m pitch. Check the pitch size and your playing intervals.`,
    );
  } else if (suggestedPreset) {
    notes.push(`A ${PITCH_PRESETS[suggestedPreset].label} pitch (${PITCH_PRESETS[suggestedPreset].length} × ${PITCH_PRESETS[suggestedPreset].width} m) fits your movement better.`);
  }
  if (!spansLength || !spansWidth || angleUnsure) {
    notes.push(
      `You covered about ${Math.round(footprint.length)} × ${Math.round(footprint.width)} m of the ${L} × ${W} m pitch, so its exact position${angleUnsure ? " and angle" : ""} can't be pinned down from movement alone. Drag the corners onto the real pitch if you know where it is.`,
    );
  }
  if (roleMeta && !attackFromRole && rolePoints.length >= MIN_POINTS) {
    notes.push(`Your movement as a ${roleMeta.name.toLowerCase()} doesn't show which way you attacked, so pick the direction you attacked in the first half.`);
  } else if (!roleMeta) {
    notes.push("Without a position, the attacking direction can't be told from movement, so pick the direction you attacked in the first half.");
  }

  return { corners, alternative, confidence, insideShare, footprint, attackFromRole, suggestedPreset, notes };
}
