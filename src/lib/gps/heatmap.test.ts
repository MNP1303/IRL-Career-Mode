import { describe, expect, it } from "vitest";
import { buildHeatGrid, gridZoneShares, placement, sampleGrid, type PitchSample } from "@/lib/gps/heatmap";
import { processTracking } from "@/lib/gps/pipeline";
import { screenActivity } from "@/lib/gps/screen";
import { decodeHeatmap, toStored } from "@/lib/gps/record";
import { parseActivity } from "@/lib/gps/parse";
import { encode, samplePath, seeded, testCalibration, TEST_START, toGpx } from "@/lib/gps/testing/synthetic";
import type { PitchPoint } from "@/lib/gps/types";

const PITCH = { length: 105, width: 68 };

const run = (path: (s: number) => PitchPoint, seconds: number, stepS = 1, start = 0): PitchSample[] => {
  const samples: PitchSample[] = [];
  for (let s = 0; s <= seconds + 1e-9; s += stepS) samples.push({ t: start + s * 1000, ...path(s) });
  return samples;
};

/** End-to-end: synthetic GPX → parse → screen → process. */
function processPath(path: (s: number) => PitchPoint, seconds: number, stepS = 1, calibration = testCalibration()) {
  const samples = samplePath(path, { seconds, stepS, calibration });
  const activity = parseActivity(encode(toGpx([samples])));
  const screen = screenActivity(activity);
  return processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
}

describe("heatmap engine", () => {
  it("puts a stationary player's whole time at one spot", () => {
    const grid = buildHeatGrid([run(() => ({ x: 52.5, y: 34 }), 600)], PITCH);
    expect(grid.totalSeconds).toBeCloseTo(600, 6);
    const centre = sampleGrid(grid, 52.5, 34);
    expect(centre).toBe(grid.maxValue > 0 ? centre : 0);
    expect(sampleGrid(grid, 52.5, 34)).toBeGreaterThan(sampleGrid(grid, 58, 34) * 10);
    // Smoothing keeps the total time (the spot is far from the grid edge).
    const sum = grid.values.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(600, 0);
  });

  it("spreads a steady run evenly along a line", () => {
    const grid = buildHeatGrid([run((s) => ({ x: 10 + s, y: 34 }), 80)], PITCH);
    const samples = [20, 35, 50, 65, 80].map((x) => sampleGrid(grid, x, 34));
    const mean = samples.reduce((a, b) => a + b) / samples.length;
    for (const value of samples) expect(Math.abs(value - mean) / mean).toBeLessThan(0.05);
    expect(sampleGrid(grid, 50, 50)).toBeLessThan(mean * 0.01);
  });

  it("draws a ring for a circular run, with a quiet centre", () => {
    const grid = buildHeatGrid([run((s) => ({ x: 52.5 + 15 * Math.cos(s / 20), y: 34 + 15 * Math.sin(s / 20) }), 20 * Math.PI * 2 * 3)], PITCH);
    const ring = [0, 1, 2, 3, 4, 5].map((k) => sampleGrid(grid, 52.5 + 15 * Math.cos(k), 34 + 15 * Math.sin(k)));
    const min = Math.min(...ring);
    const max = Math.max(...ring);
    expect(max / min).toBeLessThan(1.2);
    expect(sampleGrid(grid, 52.5, 34)).toBeLessThan(min * 0.01);
  });

  it("is independent of sampling rate", () => {
    const path = (s: number) => ({ x: 10 + s * 1.5, y: 20 + Math.sin(s / 10) * 10 });
    const fast = buildHeatGrid([run(path, 60, 1)], PITCH);
    const slow = buildHeatGrid([run(path, 60, 5)], PITCH);
    expect(slow.totalSeconds).toBeCloseTo(fast.totalSeconds, 6);
    // Same total and nearly the same shape (slow sampling cuts the curve's corners slightly).
    let difference = 0;
    for (let i = 0; i < fast.values.length; i += 1) difference += Math.abs(fast.values[i] - slow.values[i]);
    expect(difference / fast.totalSeconds).toBeLessThan(0.15);

    const still = (stepS: number) => buildHeatGrid([run(() => ({ x: 30, y: 30 }), 300, stepS)], PITCH);
    expect(still(1).maxValue).toBeCloseTo(still(5).maxValue, 4);
  });

  it("splits time into thirds and channels", () => {
    const grid = buildHeatGrid(
      [run(() => ({ x: 10, y: 10 }), 300), run(() => ({ x: 90, y: 60 }), 100, 1, 1_000_000)],
      PITCH,
    );
    const zones = gridZoneShares(grid, PITCH);
    expect(zones.thirds[0].share).toBeCloseTo(0.75, 2);
    expect(zones.thirds[2].share).toBeCloseTo(0.25, 2);
    expect(zones.channels[0].share).toBeCloseTo(0.75, 2);
    expect(zones.channels[2].share).toBeCloseTo(0.25, 2);
  });

  it("classifies positions without snapping them", () => {
    expect(placement({ x: 0, y: 0 }, PITCH, 5)).toBe("in");
    expect(placement({ x: -3, y: 30 }, PITCH, 5)).toBe("near");
    expect(placement({ x: 108, y: 71 }, PITCH, 5)).toBe("near");
    expect(placement({ x: 30, y: -6 }, PITCH, 5)).toBe("off");
  });
});

describe("processing pipeline", () => {
  it("never counts a gap as standing still", () => {
    const calibration = testCalibration();
    const first = samplePath((s) => ({ x: 20 + s * 0.1, y: 20 }), { seconds: 300, calibration });
    // Recording stops for 10 minutes, then resumes elsewhere.
    const second = samplePath((s) => ({ x: 80, y: 50 - s * 0.05 }), { seconds: 300, start: TEST_START + 900_000, calibration });
    const activity = parseActivity(encode(toGpx([[...first, ...second]])));
    const screen = screenActivity(activity);
    expect(screen.gaps).toHaveLength(1);
    const result = processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
    expect(result.diagnostics.onPitchMs).toBeCloseTo(600_000, -3);
    expect(result.metrics.trackedTime.value).toBeCloseTo(600, 0);
    // Nothing is drawn along the line between the two places.
    const grid = decodeHeatmap(toStored(result).heatmap);
    expect(sampleGrid(grid, 50, 35)).toBeLessThan(grid.maxValue * 0.001);
    // Distance never includes the 60 m jump across the gap.
    expect(result.metrics.distance.value).toBeCloseTo(30 + 15, 0);
  });

  it("excludes GPS jumps and keeps a diagnostic for each", () => {
    const calibration = testCalibration();
    const samples = samplePath((s) => ({ x: 30 + Math.abs((s % 80) - 40), y: 30 }), { seconds: 900, calibration });
    // Three isolated spikes 200 m away.
    for (const index of [100, 400, 700]) samples[index] = { ...samples[index], lat: samples[index].lat + 0.002 };
    const activity = parseActivity(encode(toGpx([samples])));
    const screen = screenActivity(activity);
    expect(screen.excluded["speed-spike"]).toBe(3);
    const result = processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
    expect(result.counts.excluded["speed-spike"]).toBe(3);
    expect(result.counts.excluded["off-pitch"] ?? 0).toBe(0);
    expect(result.metrics.topSpeed.value!).toBeLessThan(1.2);
  });

  it("accepts a real relocation after a run of consistent jumps", () => {
    const calibration = testCalibration();
    const before = samplePath(() => ({ x: 10, y: 10 }), { seconds: 120, calibration });
    const after = samplePath(() => ({ x: 90, y: 60 }), { seconds: 120, start: TEST_START + 121_000, calibration });
    const activity = parseActivity(encode(toGpx([[...before, ...after]])));
    const screen = screenActivity(activity);
    expect(screen.excluded["speed-spike"]).toBe(4);
    expect(screen.points.filter((point) => point.breakBefore === "position-reset")).toHaveLength(1);
  });

  it("never joins a relocation back to the old position, even after several seconds", () => {
    const calibration = testCalibration();
    // 45 m in one second, then staying there: allowed distance from the old point grows with time,
    // but the new points agree with each other, so it's a relocation with a break.
    const before = samplePath((s) => ({ x: 50 + Math.sin(s / 5), y: 30 }), { seconds: 300, calibration });
    const after = samplePath((s) => ({ x: 10 + Math.sin(s / 5), y: 15 }), { seconds: 300, start: TEST_START + 301_000, calibration });
    const activity = parseActivity(encode(toGpx([[...before, ...after]])));
    const screen = screenActivity(activity);
    const reset = screen.points.findIndex((point) => point.breakBefore === "position-reset");
    expect(reset).toBe(301 + 4);
    expect(screen.excluded["speed-spike"]).toBe(4);
    const result = processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
    // No distance or time along the 45 m jump.
    const grid = decodeHeatmap(toStored(result).heatmap);
    expect(sampleGrid(grid, 30, 22.5)).toBeLessThan(grid.maxValue * 0.001);
  });

  it("excludes points far off the pitch and counts near-line points where they are", () => {
    const calibration = testCalibration();
    const samples = samplePath((s) => ({ x: 50, y: s < 400 ? 34 : s < 600 ? -3 : -40 }), { seconds: 900, calibration });
    const activity = parseActivity(encode(toGpx([samples.filter((_, i) => i < 395 || i > 405)])));
    const screen = screenActivity(activity);
    const result = processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
    expect(result.counts.nearLines).toBeGreaterThan(150);
    expect(result.counts.excluded["off-pitch"]).toBeGreaterThan(250);
    const grid = decodeHeatmap(toStored(result).heatmap);
    // Near-line time sits outside the line, where it was recorded.
    expect(sampleGrid(grid, 50, -3)).toBeGreaterThan(sampleGrid(grid, 50, 1));
    expect(result.quality.level).toBe("approximate");
  });

  it("marks short recordings insufficient", () => {
    const result = processPath((s) => ({ x: 50 + s * 0.2, y: 30 }), 120);
    expect(result.quality.level).toBe("insufficient");
    expect(result.quality.reasons.map((reason) => reason.message).join(" ")).toMatch(/at least 5 min/);
  });

  it("rates a clean, full recording usable", () => {
    const random = seeded(7);
    let x = 50;
    let y = 34;
    const result = processPath(() => {
      x = Math.min(100, Math.max(5, x + (random() - 0.5) * 4));
      y = Math.min(64, Math.max(4, y + (random() - 0.5) * 4));
      return { x, y };
    }, 30 * 60);
    expect(result.quality.level).toBe("usable");
    expect(result.counts.excluded).toEqual({});
    expect(result.preview.length).toBeLessThanOrEqual(4000);
    expect(result.quality.notes[0]).toMatch(/3–10 metres/);
  });

  it("does not let sampling rate change the map end to end", () => {
    const path = (s: number) => ({ x: 52.5 + 30 * Math.cos(s / 60), y: 34 + 20 * Math.sin(s / 60) });
    const fast = processPath(path, 1200, 1);
    const slow = processPath(path, 1200, 5);
    expect(slow.grid.totalSeconds).toBeCloseTo(fast.grid.totalSeconds, -1);
    expect(slow.quality.level).toBe("approximate");
    expect(slow.quality.reasons.some((reason) => reason.message.includes("smart recording"))).toBe(true);
  });

  it("round-trips the stored heatmap within quantisation error", () => {
    const result = processPath((s) => ({ x: 20 + (s % 60), y: 20 + (s % 30) }), 900);
    const { heatmap, summary } = toStored(result);
    const decoded = decodeHeatmap(heatmap);
    let worst = 0;
    for (let i = 0; i < decoded.values.length; i += 1) worst = Math.max(worst, Math.abs(decoded.values[i] - result.grid.values[i]));
    expect(worst).toBeLessThan(result.grid.maxValue / 60000);
    expect(summary.algorithmVersion).toBe(1);
    expect(JSON.stringify(summary).length).toBeLessThan(16_000);
    expect(heatmap.data.length).toBeLessThan(40_000);
  });
});
