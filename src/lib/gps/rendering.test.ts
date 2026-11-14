import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHeatGrid } from "@/lib/gps/heatmap";
import { heatColour, paintHeat } from "@/lib/gps/render";
import { decodeHeatmap, encodeHeatmap } from "@/lib/gps/record";
import { handleRequest } from "@/lib/gps/worker-protocol";
import { testCalibration } from "@/lib/gps/testing/synthetic";

const PITCH = { length: 105, width: 68 };

describe("heat rendering", () => {
  it("runs green → yellow → red and leaves faint noise transparent", () => {
    expect(heatColour(0.01).alpha).toBe(0);
    const low = heatColour(0.1).rgb;
    const high = heatColour(1).rgb;
    expect(low[1]).toBeGreaterThan(low[0]);
    expect(high[0]).toBeGreaterThan(high[1]);
  });

  it("paints the same spot in the 2D framing and on the 3D surface framing", () => {
    const samples = Array.from({ length: 300 }, (_, s) => ({ t: s * 1000, x: 80, y: 20 }));
    const grid = decodeHeatmap(encodeHeatmap(buildHeatGrid([samples], PITCH)));
    const hottest = (pixels: Uint8ClampedArray, width: number) => {
      let best = 0;
      let index = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > best) [best, index] = [pixels[i], (i - 3) / 4];
      return { x: index % width, y: Math.floor(index / width) };
    };
    // 2D: the pitch plus a 6 m margin, at true proportions.
    const w2 = 117;
    const h2 = 80;
    const flat = hottest(paintHeat(grid, w2, h2, (u, v) => ({ x: -6 + u * 117, y: -6 + v * 80 })), w2);
    expect(-6 + ((flat.x + 0.5) / w2) * 117).toBeCloseTo(80, -0.3);
    expect(-6 + ((flat.y + 0.5) / h2) * 80).toBeCloseTo(20, -0.3);
    // 3D: the plinth surface (7 m run-off), canvas top = the left touchline side.
    const w3 = 238;
    const h3 = 164;
    const surface = hottest(paintHeat(grid, w3, h3, (u, v) => ({ x: -7 + u * 119, y: -7 + v * 82 })), w3);
    expect(-7 + ((surface.x + 0.5) / w3) * 119).toBeCloseTo(80, -0.3);
    expect(-7 + ((surface.y + 0.5) / h3) * 82).toBeCloseTo(20, -0.3);
  });
});

describe("worker protocol", () => {
  it("parses once, then re-processes from the cached session with new settings", async () => {
    const bytes = readFileSync(path.resolve(import.meta.dirname, "__fixtures__/synthetic-activity.fit"));
    const parsed = await handleRequest({ id: 1, type: "parse", bytes: new Uint8Array(bytes).buffer });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.type !== "parse") return;
    expect(parsed.parsed.format).toBe("fit");
    const { activity, session } = parsed.parsed;
    const intervals = activity.segments.map((segment) => ({ start: segment.points[0].t, end: segment.points.at(-1)!.t }));
    const processed = await handleRequest({ id: 2, type: "process", session, intervals, calibration: testCalibration(105, 68, 90) });
    expect(processed.ok).toBe(true);
    if (!processed.ok || processed.type !== "process") return;
    // The fixture jogs an ellipse inside a 105 × 68 m pitch at 1 Hz for 18.5 minutes of timer time.
    expect(processed.result.counts.excluded["off-pitch"] ?? 0).toBe(0);
    expect(processed.result.metrics.playingTime.value).toBe(600 + 480);
    expect(processed.result.metrics.deviceDistance.provenance).toBe("device");
    expect(processed.result.metrics.heartRateMax.provenance).toBe("device");
    expect(processed.result.quality.level).toBe("usable");
  });

  it("reports import errors without echoing file contents", async () => {
    const response = await handleRequest({ id: 3, type: "parse", bytes: new TextEncoder().encode("secret,lat,lon\n1,2,3").buffer });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error.code).toBe("unsupported_format");
    expect(response.error.message).not.toContain("secret");
    const stale = await handleRequest({ id: 4, type: "process", session: "gone", intervals: [], calibration: testCalibration() });
    expect(stale.ok).toBe(false);
  });
});

describe("season GPS heatmaps", () => {
  it("lines matches on different pitch sizes up by relative position and keeps each match's time", async () => {
    const { combineHeatmaps, SEASON_PITCH } = await import("@/lib/gps/season");
    const { gridZoneShares } = await import("@/lib/gps/heatmap");
    // Ten minutes three-quarters up the left flank of a 7-a-side pitch, five on the same spot of a full-size one.
    const small = { length: 60, width: 40 };
    const smallGrid = buildHeatGrid([Array.from({ length: 601 }, (_, s) => ({ t: s * 1000, x: 45, y: 8 }))], small);
    const bigGrid = buildHeatGrid([Array.from({ length: 301 }, (_, s) => ({ t: s * 1000, x: 78.75, y: 13.6 }))], PITCH);
    const season = combineHeatmaps([
      { pitch: small, grid: decodeHeatmap(encodeHeatmap(smallGrid)), totalSeconds: smallGrid.totalSeconds },
      { pitch: PITCH, grid: decodeHeatmap(encodeHeatmap(bigGrid)), totalSeconds: bigGrid.totalSeconds },
    ])!;
    expect(season.matches).toBe(2);
    expect(season.totalSeconds).toBeCloseTo(900, 0);
    expect(season.values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(900, 0);
    let hottest = 0;
    for (let index = 1; index < season.values.length; index += 1) if (season.values[index] > season.values[hottest]) hottest = index;
    const x = season.originX + ((hottest % season.cols) + 0.5) * season.cellM;
    const y = season.originY + (Math.floor(hottest / season.cols) + 0.5) * season.cellM;
    expect(Math.abs(x - 78.75)).toBeLessThan(1.5);
    expect(Math.abs(y - 13.6)).toBeLessThan(1.5);
    const shares = gridZoneShares(season, SEASON_PITCH);
    expect(shares.thirds[2].share).toBeGreaterThan(0.9);
    expect(shares.channels[0].share).toBeGreaterThan(0.9);
    expect(combineHeatmaps([])).toBeNull();
  });
});
