/**
 * Season GPS heatmaps: several matches' heatmaps on one standard pitch.
 *
 * Matches are played on pitches of different sizes, so each match's grid is
 * resampled by relative position (the same fraction of length and width) onto
 * a 105 × 68 m reference pitch, then rescaled so it adds exactly its own
 * recorded time. A longer match therefore counts for more, and no match's
 * positions are moved except by that proportional scaling.
 */

import { emptyGrid, sampleGrid } from "@/lib/gps/heatmap";
import type { DrawableGrid } from "@/lib/gps/record";
import type { PitchDimensions } from "@/lib/gps/types";

export const SEASON_PITCH: PitchDimensions = { length: 105, width: 68 };

export interface SeasonInput {
  pitch: PitchDimensions;
  grid: DrawableGrid;
  /** Recorded on-pitch seconds for the match (the stored heatmap's total). */
  totalSeconds: number;
}

export interface SeasonGrid extends DrawableGrid {
  /** For zone shares: the combined (already smoothed) seconds per cell. */
  raw: Float32Array;
  totalSeconds: number;
  matches: number;
}

export function combineHeatmaps(items: SeasonInput[], reference: PitchDimensions = SEASON_PITCH): SeasonGrid | null {
  const usable = items.filter((item) => item.totalSeconds > 0 && item.grid.maxValue > 0);
  if (!usable.length) return null;
  const base = emptyGrid(reference);
  const values = new Float32Array(base.cols * base.rows);
  const scratch = new Float32Array(values.length);
  let totalSeconds = 0;
  for (const item of usable) {
    const sx = item.pitch.length / reference.length;
    const sy = item.pitch.width / reference.width;
    let sum = 0;
    for (let row = 0; row < base.rows; row += 1) {
      const y = (base.originY + (row + 0.5) * base.cellM) * sy;
      for (let col = 0; col < base.cols; col += 1) {
        const value = sampleGrid(item.grid, (base.originX + (col + 0.5) * base.cellM) * sx, y);
        scratch[row * base.cols + col] = value;
        sum += value;
      }
    }
    if (sum <= 0) continue;
    const scale = item.totalSeconds / sum;
    for (let index = 0; index < values.length; index += 1) values[index] += scratch[index] * scale;
    totalSeconds += item.totalSeconds;
  }
  let maxValue = 0;
  for (const value of values) if (value > maxValue) maxValue = value;
  if (maxValue <= 0) return null;
  return { cols: base.cols, rows: base.rows, cellM: base.cellM, originX: base.originX, originY: base.originY, values, raw: values, maxValue, totalSeconds, matches: usable.length };
}
