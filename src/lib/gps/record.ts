/**
 * The stored form of a processed GPS import, and its validation.
 *
 * A record is split in two so match pages stay light:
 * - `summary`: quality, metrics, counts and everything needed to regenerate
 *   (intervals, calibration, algorithm version). A few kilobytes.
 * - `heatmap`: the smoothed density grid, quantised to 16 bits and base64
 *   encoded (about 25 KB for a full-size pitch). Loaded only when drawn.
 *
 * Raw coordinates are not stored in either; the source file in private
 * storage is the only copy of the route.
 */

import { z } from "zod";
import { CALIBRATION_VERSION, DIMENSION_LIMITS } from "@/lib/gps/calibration";
import { MAX_INTERVALS } from "@/lib/gps/trim";
import type { HeatGrid } from "@/lib/gps/heatmap";
import type { TrackingResult } from "@/lib/gps/pipeline";

export const RECORD_SCHEMA_VERSION = 1;
const MAX_GRID_CELLS = 200 * 150;

const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

export const calibrationSchema = z.object({
  version: z.literal(CALIBRATION_VERSION),
  corners: z.tuple([latLon, latLon, latLon, latLon]),
  length: z.number().min(DIMENSION_LIMITS.minLength).max(DIMENSION_LIMITS.maxLength),
  width: z.number().min(DIMENSION_LIMITS.minWidth).max(DIMENSION_LIMITS.maxWidth),
  preset: z.enum(["5v5", "7v7", "11v11", "custom"]),
  cornerSource: z.enum(["placed", "entered", "saved", "estimated"]),
});

const metric = z.object({
  value: z.number().nullable(),
  unit: z.enum(["m", "s", "m/s", "bpm", "count"]),
  provenance: z.enum(["device", "calculated", "approximate", "unavailable"]),
  note: z.string().max(300).optional(),
});

const share = z.object({ label: z.string().max(40), share: z.number().min(0).max(1) });

export const intervalSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  switchedEnds: z.boolean().optional(),
});

export const summarySchema = z.object({
  schemaVersion: z.literal(RECORD_SCHEMA_VERSION),
  algorithmVersion: z.number().int().min(1),
  heatmapOptions: z.object({ cellM: z.number().positive(), nearToleranceM: z.number().min(0), sigmaM: z.number().min(0) }),
  pitch: z.object({ length: z.number(), width: z.number() }),
  calibration: calibrationSchema,
  calibrationFit: z.object({
    rms: z.number(),
    residuals: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    measuredSides: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    attackBearing: z.number(),
  }),
  intervals: z.array(intervalSchema).min(1).max(MAX_INTERVALS),
  counts: z.object({
    recorded: z.number().int().min(0),
    outsideIntervals: z.number().int().min(0),
    valid: z.number().int().min(0),
    inBounds: z.number().int().min(0),
    nearLines: z.number().int().min(0),
    excluded: z.record(z.string(), z.number().int().min(0)),
  }),
  quality: z.object({
    level: z.enum(["usable", "approximate", "insufficient"]),
    reasons: z.array(z.object({ severity: z.enum(["insufficient", "approximate"]), message: z.string().max(400) })).max(20),
    notes: z.array(z.string().max(400)).max(10),
    coverage: z.number(),
    onPitchShare: z.number(),
  }),
  metrics: z.object({
    playingTime: metric,
    trackedTime: metric,
    distance: metric,
    deviceDistance: metric,
    averageSpeed: metric,
    topSpeed: metric,
    heartRateAverage: metric,
    heartRateMax: metric,
    sprints: metric,
  }),
  zones: z.object({ thirds: z.array(share).length(3), channels: z.array(share).length(3) }),
  diagnostics: z.object({
    medianSamplingMs: z.number(),
    gapCount: z.number().int().min(0),
    gapThresholdMs: z.number(),
    playingMs: z.number(),
    trackedMs: z.number(),
    onPitchMs: z.number(),
    accuracyMedianM: z.number().nullable(),
  }),
});

export const heatmapSchema = z
  .object({
    encoding: z.literal("u16-base64"),
    cols: z.number().int().min(1).max(400),
    rows: z.number().int().min(1).max(400),
    cellM: z.number().positive(),
    originX: z.number(),
    originY: z.number(),
    maxSeconds: z.number().min(0),
    totalSeconds: z.number().min(0),
    data: z.string().max(MAX_GRID_CELLS * 3),
  })
  .refine((grid) => grid.cols * grid.rows <= MAX_GRID_CELLS, "Heatmap grid is too large");

export type TrackingSummary = z.infer<typeof summarySchema>;
export type StoredHeatmap = z.infer<typeof heatmapSchema>;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeHeatmap(grid: HeatGrid): StoredHeatmap {
  const quantised = new Uint16Array(grid.values.length);
  const scale = grid.maxValue > 0 ? 65535 / grid.maxValue : 0;
  for (let index = 0; index < grid.values.length; index += 1) quantised[index] = Math.round(grid.values[index] * scale);
  // Uint16Array is platform-endian; every supported browser is little-endian, and decode mirrors it.
  return {
    encoding: "u16-base64",
    cols: grid.cols,
    rows: grid.rows,
    cellM: grid.cellM,
    originX: grid.originX,
    originY: grid.originY,
    maxSeconds: grid.maxValue,
    totalSeconds: grid.totalSeconds,
    data: toBase64(new Uint8Array(quantised.buffer)),
  };
}

/** A grid ready for drawing: `values` are smoothed seconds per cell. */
export interface DrawableGrid {
  cols: number;
  rows: number;
  cellM: number;
  originX: number;
  originY: number;
  values: Float32Array;
  maxValue: number;
}

export function decodeHeatmap(stored: StoredHeatmap): DrawableGrid {
  const bytes = fromBase64(stored.data);
  const cells = stored.cols * stored.rows;
  if (bytes.length !== cells * 2) throw new Error("Stored heatmap is damaged");
  const quantised = new Uint16Array(bytes.buffer, bytes.byteOffset, cells);
  const values = new Float32Array(cells);
  const scale = stored.maxSeconds / 65535;
  for (let index = 0; index < cells; index += 1) values[index] = quantised[index] * scale;
  return { cols: stored.cols, rows: stored.rows, cellM: stored.cellM, originX: stored.originX, originY: stored.originY, values, maxValue: stored.maxSeconds };
}

export function toStored(result: TrackingResult): { summary: TrackingSummary; heatmap: StoredHeatmap } {
  const summary: TrackingSummary = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    algorithmVersion: result.algorithmVersion,
    heatmapOptions: result.heatmapOptions,
    pitch: result.pitch,
    calibration: result.calibration,
    calibrationFit: result.calibrationFit,
    intervals: result.intervals,
    counts: { ...result.counts, excluded: { ...result.counts.excluded } as Record<string, number> },
    quality: result.quality,
    metrics: result.metrics,
    zones: result.zones,
    diagnostics: result.diagnostics,
  };
  return { summary: summarySchema.parse(summary), heatmap: heatmapSchema.parse(encodeHeatmap(result.grid)) };
}
