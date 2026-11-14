import { describe, expect, it } from "vitest";
import { createTransform } from "@/lib/gps/calibration";
import { detectPitch, type DetectPoint } from "@/lib/gps/detect";
import { groundDistance } from "@/lib/gps/geo";
import { seeded, TEST_START, testCalibration } from "@/lib/gps/testing/synthetic";
import type { PitchPoint } from "@/lib/gps/types";

type Zone = { x: [number, number]; y: [number, number] };

/**
 * A made-up player moving between random spots in a zone at match-like
 * speeds, with GPS noise. Runs are biased along the pitch's length.
 */
function play(zone: Zone, { seconds = 2400, stepS = 1, seed = 7, start = TEST_START, noiseM = 1.5, attackBias = false } = {}) {
  const random = seeded(seed);
  const pick = (range: [number, number], biased = false) => range[0] + (biased ? Math.sqrt(random()) : random()) * (range[1] - range[0]);
  const path: { t: number; p: PitchPoint }[] = [];
  let at = { x: pick(zone.x), y: pick(zone.y) };
  let target = at;
  let speed = 2;
  for (let s = 0; s <= seconds; s += stepS) {
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    const distance = Math.hypot(dx, dy);
    if (distance < speed * stepS) {
      at = target;
      // Long runs along the pitch, shorter shuffles across it.
      target = { x: random() < 0.7 ? pick(zone.x, attackBias) : at.x + (random() - 0.5) * 8, y: random() < 0.3 ? pick(zone.y) : at.y + (random() - 0.5) * 6 };
      target = { x: Math.min(zone.x[1], Math.max(zone.x[0], target.x)), y: Math.min(zone.y[1], Math.max(zone.y[0], target.y)) };
      speed = random() < 0.25 ? 6 : random() < 0.6 ? 3.5 : 1.2;
    } else {
      at = { x: at.x + (dx / distance) * speed * stepS, y: at.y + (dy / distance) * speed * stepS };
    }
    path.push({ t: start + s * 1000, p: { x: at.x + (random() - 0.5) * 2 * noiseM, y: at.y + (random() - 0.5) * 2 * noiseM } });
  }
  return path;
}

const toPoints = (path: { t: number; p: PitchPoint }[], calibration = testCalibration(105, 68, 30)): DetectPoint[] => {
  const transform = createTransform(calibration);
  return path.map(({ t, p }) => ({ t, ...transform.fromPitch(p) }));
};

function cornerErrors(detected: DetectPoint[] | ReturnType<typeof testCalibration>["corners"], truth: ReturnType<typeof testCalibration>["corners"]) {
  return truth.map((corner, index) => groundDistance(corner, detected[index]));
}

describe("pitch detection from movement", () => {
  const truth = testCalibration(105, 68, 30);

  it("finds a pitch a winger covered end to end, with the attack direction from the role", () => {
    // Up and down the whole left flank, spending more time in the attacking half.
    const points = toPoints(play({ x: [2, 104], y: [0.5, 24] }, { attackBias: true }), truth);
    const detected = detectPitch(points, truth, { position: "LW" })!;
    expect(detected.insideShare).toBeGreaterThan(0.97);
    expect(detected.attackFromRole).toBe(true);
    expect(detected.alternative).toBeNull();
    // Corner order matters: each corner must be the right one, not just the right rectangle.
    for (const error of cornerErrors(detected.corners, truth.corners)) expect(error).toBeLessThan(8);
    expect(createTransform({ ...truth, corners: detected.corners, cornerSource: "estimated" }).fit.ok).toBe(true);
  });

  it("places a centre back in their own half, and says the attack direction needs checking", () => {
    const points = toPoints(play({ x: [4, 55], y: [12, 56] }, { seed: 11 }), truth);
    const detected = detectPitch(points, truth, { position: "CB" })!;
    const transform = createTransform({ ...truth, corners: detected.corners, cornerSource: "estimated" });
    // The pitch's axis is right (either way along it)…
    const bearing = transform.fit.attackBearing;
    expect(Math.min(Math.abs(bearing - 30), Math.abs(bearing - 210))).toBeLessThan(6);
    // …and their average spot lands in their own half, whichever way that is.
    const meanX = points.reduce((sum, point) => sum + transform.toPitch(point).x, 0) / points.length;
    expect(meanX).toBeLessThan(40);
    // Covering one half can't show which half it was: both directions fit the movement equally,
    // so the other one is offered too, again with the centre back in their own half.
    expect(detected.attackFromRole).toBe(false);
    expect(detected.notes.join(" ")).toMatch(/pick the direction you attacked/);
    const other = createTransform({ ...truth, corners: detected.alternative!, cornerSource: "estimated" });
    // Opposite bearings.
    expect(Math.abs(((other.fit.attackBearing - bearing + 540) % 360) - 180)).toBeGreaterThan(179);
    expect(points.reduce((sum, point) => sum + other.toPitch(point).x, 0) / points.length).toBeLessThan(40);
    // One of the two is the real pitch.
    const worst = (corners: typeof truth.corners) => Math.max(...cornerErrors(corners, truth.corners));
    expect(Math.min(worst(detected.corners), worst(detected.alternative!))).toBeLessThan(12);
  });

  it("is not swayed by sampling rate, or by a walk to the bench", () => {
    const fast = play({ x: [20, 100], y: [5, 63] }, { seed: 3, seconds: 1200 });
    const slow = play({ x: [20, 100], y: [5, 63] }, { seed: 4, seconds: 1200, stepS: 5, start: TEST_START + 1_201_000 });
    const bench = Array.from({ length: 120 }, (_, s) => ({ t: TEST_START + 2_402_000 + s * 1000, p: { x: 52, y: -25 - s * 0.4 } }));
    const detected = detectPitch(toPoints([...fast, ...slow, ...bench], truth), truth, { position: "CM" })!;
    // The orientation is right even though the attack direction can't be told for a central midfielder.
    const transform = createTransform({ ...truth, corners: detected.corners, cornerSource: "estimated" });
    const bearing = transform.fit.attackBearing;
    expect(Math.min(Math.abs(bearing - 30), Math.abs(bearing - 210))).toBeLessThan(6);
    expect(detected.footprint.length).toBeGreaterThan(70);
  });

  it("flags a pitch that's too small for the movement and suggests a size that fits", () => {
    const points = toPoints(play({ x: [2, 103], y: [2, 66] }, { seed: 5 }), truth);
    const detected = detectPitch(points, { length: 40, width: 20 }, { position: "CM" })!;
    expect(detected.confidence).toBe("low");
    expect(detected.suggestedPreset).toBe("11v11");
    expect(detected.notes[0]).toMatch(/outside a 40 × 20 m pitch/);
  });

  it("says when movement alone can't pin the pitch down", () => {
    const points = toPoints(play({ x: [45, 65], y: [25, 40] }, { seed: 9, seconds: 900 }), truth);
    const detected = detectPitch(points, truth)!;
    // A small patch fits a big pitch at any angle, and short shuffles don't show the pitch's axes either.
    expect(detected.confidence).toBe("low");
    expect(detected.attackFromRole).toBe(false);
    expect(detected.notes.join(" ")).toMatch(/position and angle can't be pinned down/);
    // Always the stated size: never stretched to the movement.
    const fit = createTransform({ ...truth, corners: detected.corners, cornerSource: "estimated" }).fit;
    expect(fit.rms).toBeLessThan(0.05);
  });

  it("needs enough positions", () => {
    expect(detectPitch(toPoints(play({ x: [0, 10], y: [0, 10] }).slice(0, 10)), truth)).toBeNull();
  });
});
