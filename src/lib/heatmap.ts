import { ZONE_COLS, ZONE_ROWS } from "@/lib/domain";
import type { Match, ZoneCell } from "@/lib/schema";

export type ZoneGrid = number[];

export const cellIndex = (col: number, row: number) => row * ZONE_COLS + col;

/** Sums painted intensity per cell across the given matches. */
export function aggregateZones(matches: Pick<Match, "zones">[]): ZoneGrid {
  const grid: ZoneGrid = new Array(ZONE_COLS * ZONE_ROWS).fill(0);
  for (const match of matches) {
    for (const cell of match.zones) grid[cellIndex(cell.col, cell.row)] += cell.intensity;
  }
  return grid;
}

export function gridFromCells(cells: ZoneCell[]) {
  return aggregateZones([{ zones: cells }]);
}

const THIRDS = ["Defensive third", "Middle third", "Attacking third"] as const;
/** Rows run from the left touchline to the right, facing the opposition goal. */
const CHANNELS = ["Left", "Centre", "Right"] as const;

const thirdOf = (col: number) => Math.min(2, Math.floor((col / ZONE_COLS) * 3));
const channelOf = (row: number) => (row < 3 ? 0 : row < 5 ? 1 : 2);

export function describeCell(col: number, row: number) {
  return `${THIRDS[thirdOf(col)]}, ${CHANNELS[channelOf(row)].toLowerCase()} channel`;
}

export function zoneShares(grid: ZoneGrid) {
  const total = grid.reduce((sum, value) => sum + value, 0);
  const thirds = [0, 0, 0];
  const channels = [0, 0, 0];
  let peak = -1;
  let peakValue = 0;

  grid.forEach((value, index) => {
    const col = index % ZONE_COLS;
    const row = Math.floor(index / ZONE_COLS);
    thirds[thirdOf(col)] += value;
    channels[channelOf(row)] += value;
    if (value > peakValue) {
      peakValue = value;
      peak = index;
    }
  });

  const share = (value: number) => (total ? value / total : 0);
  return {
    total,
    thirds: THIRDS.map((label, index) => ({ label, share: share(thirds[index]) })),
    channels: CHANNELS.map((label, index) => ({ label, share: share(channels[index]) })),
    hottest:
      peak >= 0
        ? describeCell(peak % ZONE_COLS, Math.floor(peak / ZONE_COLS))
        : null,
  };
}

/** Smooths the coarse grid into a density field normalised to 0–1. */
export function densityField(grid: ZoneGrid, width: number, height: number) {
  const field = new Float32Array(width * height);
  const sigma = 0.72;
  const reach = 3;
  let max = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const col = ((x + 0.5) / width) * ZONE_COLS - 0.5;
      const row = ((y + 0.5) / height) * ZONE_ROWS - 0.5;
      let sum = 0;
      for (let r = Math.max(0, Math.floor(row) - reach); r <= Math.min(ZONE_ROWS - 1, Math.ceil(row) + reach); r += 1) {
        for (let c = Math.max(0, Math.floor(col) - reach); c <= Math.min(ZONE_COLS - 1, Math.ceil(col) + reach); c += 1) {
          const value = grid[cellIndex(c, r)];
          if (!value) continue;
          const distance = (c - col) ** 2 + (r - row) ** 2;
          sum += value * Math.exp(-distance / (2 * sigma * sigma));
        }
      }
      field[y * width + x] = sum;
      max = Math.max(max, sum);
    }
  }
  if (max > 0) for (let i = 0; i < field.length; i += 1) field[i] /= max;
  return field;
}

/** One hue from deep pitch green through electric lime to a white-hot core. */
const RAMP: { at: number; rgb: [number, number, number]; alpha: number }[] = [
  { at: 0, rgb: [60, 110, 20], alpha: 0 },
  { at: 0.18, rgb: [90, 150, 24], alpha: 0.32 },
  { at: 0.45, rgb: [150, 215, 30], alpha: 0.66 },
  { at: 0.75, rgb: [200, 255, 46], alpha: 0.88 },
  { at: 1, rgb: [244, 255, 214], alpha: 0.98 },
];

export function rampColor(value: number) {
  const upper = RAMP.findIndex((stop) => value <= stop.at);
  if (upper <= 0) return { rgb: RAMP[0].rgb, alpha: value <= 0 ? 0 : RAMP[0].alpha };
  const low = RAMP[upper - 1];
  const high = RAMP[upper];
  const mix = (value - low.at) / (high.at - low.at);
  const channel = (index: number) => low.rgb[index] + (high.rgb[index] - low.rgb[index]) * mix;
  return {
    rgb: [channel(0), channel(1), channel(2)] as [number, number, number],
    alpha: low.alpha + (high.alpha - low.alpha) * mix,
  };
}

/** Paints the heatmap onto a canvas, for the SVG image and the 3D pitch texture alike. */
export function heatmapCanvas(grid: ZoneGrid, width = 210, height = 136) {
  if (!grid.some(Boolean)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const field = densityField(grid, width, height);
  const image = context.createImageData(width, height);
  field.forEach((value, index) => {
    // Steepen the curve so only the most repeated areas reach the white core.
    const { rgb, alpha } = rampColor(value ** 1.5);
    const offset = index * 4;
    image.data[offset] = rgb[0];
    image.data[offset + 1] = rgb[1];
    image.data[offset + 2] = rgb[2];
    image.data[offset + 3] = alpha * 255;
  });
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Paints the heatmap to an image so it can sit inside the pitch SVG. */
export function renderHeatmap(grid: ZoneGrid, width = 210, height = 136) {
  return heatmapCanvas(grid, width, height)?.toDataURL("image/png") ?? null;
}
