/**
 * GPS heatmap engine: pure TypeScript, no React, no Three.js.
 *
 * Density is time, not sample count. Between two consecutive trusted samples
 * of the same run, the elapsed time is spread evenly along the straight line
 * joining them (the time density of the piecewise-linear path). So:
 * - a watch sampling every second and one sampling every five seconds give
 *   the same total for the same movement;
 * - a gap, an interval boundary or a point far off the pitch ends a run, so
 *   that time is never counted as standing still and nothing is drawn
 *   across it;
 * - a lone sample with no neighbour in its run adds no time.
 *
 * Positions are classified, never moved:
 * - in bounds: 0 ≤ x ≤ length and 0 ≤ y ≤ width;
 * - near: outside the lines by at most `nearToleranceM`, which is within
 *   normal GPS error for a player on the touchline. Counted where recorded,
 *   on a grid that extends that far past the lines;
 * - off pitch: further out. Excluded, with a diagnostic.
 *
 * Smoothing is a restrained Gaussian (σ = `sigmaM`, default 2 m).
 */

import type { PitchDimensions } from "@/lib/gps/types";

export const HEATMAP_ALGORITHM_VERSION = 1;

export interface HeatmapOptions {
  /** Grid cell size in metres. */
  cellM: number;
  /** How far outside the lines a position still counts, in metres. */
  nearToleranceM: number;
  /** Gaussian smoothing radius (standard deviation) in metres. */
  sigmaM: number;
}

export const DEFAULT_HEATMAP_OPTIONS: HeatmapOptions = { cellM: 1, nearToleranceM: 5, sigmaM: 2 };

export type Placement = "in" | "near" | "off";

export interface PitchSample {
  t: number;
  x: number;
  y: number;
}

export interface HeatGrid {
  cols: number;
  rows: number;
  cellM: number;
  /** Pitch coordinates of the grid's first cell's outer corner (negative: the grid extends past the lines). */
  originX: number;
  originY: number;
  /** Smoothed seconds per cell, row-major (row = y, col = x). */
  values: Float32Array;
  /** Unsmoothed seconds per cell, kept for zone shares. */
  raw: Float32Array;
  totalSeconds: number;
  maxValue: number;
}

export function placement(point: { x: number; y: number }, pitch: PitchDimensions, toleranceM: number): Placement {
  if (point.x >= 0 && point.x <= pitch.length && point.y >= 0 && point.y <= pitch.width) return "in";
  const dx = point.x < 0 ? -point.x : point.x > pitch.length ? point.x - pitch.length : 0;
  const dy = point.y < 0 ? -point.y : point.y > pitch.width ? point.y - pitch.width : 0;
  return Math.hypot(dx, dy) <= toleranceM ? "near" : "off";
}

export function emptyGrid(pitch: PitchDimensions, options: HeatmapOptions = DEFAULT_HEATMAP_OPTIONS) {
  const margin = options.nearToleranceM;
  const cols = Math.ceil((pitch.length + margin * 2) / options.cellM);
  const rows = Math.ceil((pitch.width + margin * 2) / options.cellM);
  return {
    cols,
    rows,
    cellM: options.cellM,
    originX: -margin,
    originY: -margin,
    raw: new Float32Array(cols * rows),
  };
}

/** Adds `seconds` at a pitch position, shared bilinearly between the four nearest cell centres. */
function splat(grid: ReturnType<typeof emptyGrid>, x: number, y: number, seconds: number) {
  const gx = (x - grid.originX) / grid.cellM - 0.5;
  const gy = (y - grid.originY) / grid.cellM - 0.5;
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const fx = gx - c0;
  const fy = gy - r0;
  const add = (col: number, row: number, weight: number) => {
    if (weight <= 0) return;
    // Cells past the grid edge clamp to it: mass is kept, never dropped.
    const c = Math.min(grid.cols - 1, Math.max(0, col));
    const r = Math.min(grid.rows - 1, Math.max(0, row));
    grid.raw[r * grid.cols + c] += seconds * weight;
  };
  add(c0, r0, (1 - fx) * (1 - fy));
  add(c0 + 1, r0, fx * (1 - fy));
  add(c0, r0 + 1, (1 - fx) * fy);
  add(c0 + 1, r0 + 1, fx * fy);
}

/** Separable Gaussian blur; normalised kernel, so total time is preserved away from the edges. */
export function gaussianBlur(values: Float32Array, cols: number, rows: number, sigmaCells: number) {
  if (sigmaCells <= 0) return Float32Array.from(values);
  const radius = Math.ceil(sigmaCells * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const weight = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells));
    kernel[i + radius] = weight;
    sum += weight;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;

  const horizontal = new Float32Array(values.length);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let total = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const c = col + k;
        if (c < 0 || c >= cols) continue;
        total += values[row * cols + c] * kernel[k + radius];
      }
      horizontal[row * cols + col] = total;
    }
  }
  const out = new Float32Array(values.length);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let total = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const r = row + k;
        if (r < 0 || r >= rows) continue;
        total += horizontal[r * cols + col] * kernel[k + radius];
      }
      out[row * cols + col] = total;
    }
  }
  return out;
}

/**
 * Builds the time-weighted density grid from runs of pitch samples. Every
 * sample in `runs` must already be in bounds or near (see `placement`), in
 * time order, and each run must be free of gaps; the pipeline guarantees this.
 */
export function buildHeatGrid(
  runs: PitchSample[][],
  pitch: PitchDimensions,
  options: HeatmapOptions = DEFAULT_HEATMAP_OPTIONS,
): HeatGrid {
  const grid = emptyGrid(pitch, options);
  let totalSeconds = 0;
  const step = options.cellM / 2;
  for (const run of runs) {
    for (let index = 1; index < run.length; index += 1) {
      const a = run[index - 1];
      const b = run[index];
      const seconds = (b.t - a.t) / 1000;
      if (seconds <= 0) continue;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(distance / step));
      const share = seconds / steps;
      for (let k = 0; k < steps; k += 1) {
        const f = (k + 0.5) / steps;
        splat(grid, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, share);
      }
      totalSeconds += seconds;
    }
  }
  const values = gaussianBlur(grid.raw, grid.cols, grid.rows, options.sigmaM / options.cellM);
  let maxValue = 0;
  for (const value of values) if (value > maxValue) maxValue = value;
  return { ...grid, values, totalSeconds, maxValue };
}

/** Seconds recorded at a pitch position (smoothed), read bilinearly; 0 outside the grid. */
export function sampleGrid(grid: Pick<HeatGrid, "cols" | "rows" | "cellM" | "originX" | "originY" | "values">, x: number, y: number) {
  const gx = (x - grid.originX) / grid.cellM - 0.5;
  const gy = (y - grid.originY) / grid.cellM - 0.5;
  if (gx < -0.5 || gy < -0.5 || gx > grid.cols - 0.5 || gy > grid.rows - 0.5) return 0;
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(gx)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(gy)));
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const fx = Math.max(0, Math.min(1, gx - c0));
  const fy = Math.max(0, Math.min(1, gy - r0));
  const v = (c: number, r: number) => grid.values[r * grid.cols + c];
  return (v(c0, r0) * (1 - fx) + v(c1, r0) * fx) * (1 - fy) + (v(c0, r1) * (1 - fx) + v(c1, r1) * fx) * fy;
}

export interface ZoneShare {
  label: string;
  share: number;
}

/**
 * Share of on-pitch time by third (along the length) and channel (across
 * it, split 3/8 · 2/8 · 3/8 like the manual zone grid). Near-line time is
 * assigned to the nearest zone for these shares only; positions are unchanged.
 */
export function gridZoneShares(grid: Pick<HeatGrid, "cols" | "rows" | "cellM" | "originX" | "originY" | "raw">, pitch: PitchDimensions) {
  const thirds = [0, 0, 0];
  const channels = [0, 0, 0];
  let total = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    const y = Math.min(pitch.width, Math.max(0, grid.originY + (row + 0.5) * grid.cellM));
    const channel = y < pitch.width * 0.375 ? 0 : y < pitch.width * 0.625 ? 1 : 2;
    for (let col = 0; col < grid.cols; col += 1) {
      const value = grid.raw[row * grid.cols + col];
      if (!value) continue;
      const x = Math.min(pitch.length, Math.max(0, grid.originX + (col + 0.5) * grid.cellM));
      const third = Math.min(2, Math.floor((x / pitch.length) * 3));
      thirds[third] += value;
      channels[channel] += value;
      total += value;
    }
  }
  const share = (value: number) => (total ? value / total : 0);
  return {
    thirds: ["Defensive third", "Middle third", "Attacking third"].map((label, index) => ({ label, share: share(thirds[index]) })),
    channels: ["Left", "Centre", "Right"].map((label, index) => ({ label, share: share(channels[index]) })),
  };
}
