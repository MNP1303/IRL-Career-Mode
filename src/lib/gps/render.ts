/**
 * Turning a density grid into pixels, shared by the 2D tactical view and the
 * 3D pitch texture so both always show the same data. Pure: it writes into
 * an RGBA buffer and never touches the DOM.
 *
 * The colour ramp follows the usual GPS heatmap convention (green → yellow →
 * red), deliberately different from the lime ramp of manual zone maps so the
 * two sources are never confused.
 */

import { sampleGrid } from "@/lib/gps/heatmap";
import type { DrawableGrid } from "@/lib/gps/record";

const RAMP: { at: number; rgb: [number, number, number]; alpha: number }[] = [
  { at: 0, rgb: [40, 170, 60], alpha: 0 },
  { at: 0.06, rgb: [52, 196, 70], alpha: 0.42 },
  { at: 0.3, rgb: [150, 220, 40], alpha: 0.72 },
  { at: 0.55, rgb: [250, 220, 40], alpha: 0.82 },
  { at: 0.78, rgb: [250, 130, 30], alpha: 0.88 },
  { at: 1, rgb: [230, 40, 30], alpha: 0.92 },
];

/** Below this share of the peak, nothing is drawn: keeps faint noise off the grass. */
export const HEAT_FLOOR = 0.03;

export function heatColour(value: number): { rgb: [number, number, number]; alpha: number } {
  if (value <= HEAT_FLOOR) return { rgb: RAMP[0].rgb, alpha: 0 };
  const v = Math.min(1, value);
  const upper = RAMP.findIndex((stop) => v <= stop.at);
  const high = RAMP[upper < 0 ? RAMP.length - 1 : upper];
  const low = RAMP[Math.max(0, (upper < 0 ? RAMP.length - 1 : upper) - 1)];
  const span = high.at - low.at || 1;
  const mix = (v - low.at) / span;
  return {
    rgb: [0, 1, 2].map((i) => low.rgb[i] + (high.rgb[i] - low.rgb[i]) * mix) as [number, number, number],
    alpha: low.alpha + (high.alpha - low.alpha) * mix,
  };
}

/** CSS for the legend, built from the same stops as the ramp. */
export const HEAT_LEGEND_GRADIENT = `linear-gradient(90deg, ${RAMP.slice(1)
  .map((stop) => `rgb(${stop.rgb.join(" ")}) ${Math.round(stop.at * 100)}%`)
  .join(", ")})`;

/**
 * Paints `grid` into an RGBA buffer `width × height`. `toPitch(u, v)` maps a
 * pixel centre (0–1 across, 0–1 down) to pitch metres, so callers decide the
 * framing (true proportions in 2D, the plinth surface in 3D).
 */
export function paintHeat(
  grid: DrawableGrid,
  width: number,
  height: number,
  toPitch: (u: number, v: number) => { x: number; y: number },
  opacity = 1,
) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (!grid.maxValue) return pixels;
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const { x, y } = toPitch((px + 0.5) / width, (py + 0.5) / height);
      const value = sampleGrid(grid, x, y) / grid.maxValue;
      // A gentle curve lifts the mid-range, so a spread-out game still reads.
      const { rgb, alpha } = heatColour(Math.pow(value, 0.75));
      const offset = (py * width + px) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = alpha * opacity * 255;
    }
  }
  return pixels;
}
