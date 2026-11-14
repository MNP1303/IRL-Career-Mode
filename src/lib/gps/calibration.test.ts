import { describe, expect, it } from "vitest";
import {
  checkCompatibility,
  createTransform,
  reverseAttack,
  swapSides,
  type PitchCalibration,
} from "@/lib/gps/calibration";
import { groundDistance as haversine, localProjection } from "@/lib/gps/geo";
import { pitchCorners, testCalibration, TEST_ORIGIN } from "@/lib/gps/testing/synthetic";

const issueCodes = (calibration: PitchCalibration) => createTransform(calibration).fit.issues.map((issue) => issue.code);

describe("pitch calibration", () => {
  it.each([
    ["5-a-side, attack north", 40, 20, 0],
    ["7-a-side, attack south-west", 60, 40, 225],
    ["11-a-side, attack east", 105, 68, 90],
    ["11-a-side, odd rotation", 100, 64, 17.3],
  ])("maps corners exactly and round-trips (%s)", (_, length, width, bearing) => {
    const transform = createTransform(testCalibration(length, width, bearing));
    expect(transform.fit.ok).toBe(true);
    expect(transform.fit.rms).toBeLessThan(0.01);
    expect(transform.fit.attackBearing).toBeCloseTo(bearing % 360, 3);
    const corners = transform.calibration.corners.map((corner) => transform.toPitch(corner));
    const expected = [
      [0, 0],
      [length, 0],
      [length, width],
      [0, width],
    ];
    corners.forEach((corner, index) => {
      expect(corner.x).toBeCloseTo(expected[index][0], 2);
      expect(corner.y).toBeCloseTo(expected[index][1], 2);
    });
    const centre = transform.fromPitch({ x: length / 2, y: width / 2 });
    expect(transform.toPitch(centre).x).toBeCloseTo(length / 2, 6);
  });

  it("preserves distances: no scaling or shearing", () => {
    const transform = createTransform(testCalibration(105, 68, 33));
    const a = transform.fromPitch({ x: 10, y: 5 });
    const b = transform.fromPitch({ x: 70, y: 50 });
    expect(haversine(a, b)).toBeCloseTo(Math.hypot(60, 45), 1);
  });

  it("puts the left touchline on the left when facing the attack", () => {
    // Attacking due east: the left touchline is the northern one.
    const transform = createTransform(testCalibration(105, 68, 90));
    const left = transform.fromPitch({ x: 50, y: 0 });
    const right = transform.fromPitch({ x: 50, y: 68 });
    expect(left.lat).toBeGreaterThan(right.lat);
  });

  it("diagnoses corners that don't match the size instead of stretching", () => {
    // Real corners of a 95 × 60 m pitch, but the player says 105 × 68.
    const calibration = { ...testCalibration(95, 60, 90), length: 105, width: 68 };
    const transform = createTransform(calibration);
    expect(transform.fit.ok).toBe(true);
    expect(issueCodes(calibration)).toContain("inconsistent-size");
    expect(transform.fit.measuredSides[0]).toBeCloseTo(95, 0);
    // The scale is untouched: 10 m on the ground is still 10 m on the pitch.
    const a = transform.toPitch(transform.fromPitch({ x: 20, y: 20 }));
    const b = transform.toPitch(transform.fromPitch({ x: 30, y: 20 }));
    expect(b.x - a.x).toBeCloseTo(10, 4);

    const wildly = { ...testCalibration(40, 20, 90), length: 105, width: 68 };
    expect(issueCodes(wildly)).toContain("size-mismatch");
    expect(createTransform(wildly).fit.ok).toBe(false);
  });

  it("rejects crossed, mirrored, collapsed and out-of-range corners", () => {
    const base = testCalibration(105, 68, 90);
    const [a, b, c, d] = base.corners;
    expect(issueCodes({ ...base, corners: [a, c, b, d] })).toContain("self-intersecting");
    // Left and right swapped by the player.
    expect(issueCodes({ ...base, corners: [d, c, b, a] })).toContain("mirrored");
    expect(issueCodes(swapSides({ ...base, corners: [d, c, b, a] }))).toEqual([]);
    expect(issueCodes({ ...base, corners: [a, a, c, d] })).toContain("corners-too-close");
    expect(issueCodes({ ...base, length: 400 })).toContain("dimensions-out-of-range");

    // A dart (concave) shape.
    const projection = localProjection(TEST_ORIGIN);
    const dart = [
      projection.inverse(-50, 30),
      projection.inverse(50, 30),
      projection.inverse(0, 10),
      projection.inverse(-50, -30),
    ] as PitchCalibration["corners"];
    expect(issueCodes({ ...base, corners: dart })).toContain("not-convex");
  });

  it("reverses the attack by turning the corners through 180°", () => {
    const base = createTransform(testCalibration(105, 68, 90));
    const reversed = createTransform(reverseAttack(base.calibration));
    const point = base.fromPitch({ x: 20, y: 10 });
    const p = reversed.toPitch(point);
    expect(p.x).toBeCloseTo(85, 3);
    expect(p.y).toBeCloseTo(58, 3);
    expect(reversed.fit.attackBearing).toBeCloseTo(270, 3);
  });

  it("checks a saved calibration against the activity", () => {
    const calibration = testCalibration(105, 68, 90);
    const transform = createTransform(calibration);
    const onPitch = Array.from({ length: 50 }, (_, i) => transform.fromPitch({ x: 10 + i, y: 30 }));
    expect(checkCompatibility(calibration, onPitch).compatible).toBe(true);
    const elsewhere = testCalibration(105, 68, 90, { lat: 52.5, lon: 13.4 });
    const result = checkCompatibility(elsewhere, onPitch);
    expect(result.compatible).toBe(false);
    expect(result.message).toMatch(/km from where/);
  });

  it("builds test corners consistently", () => {
    const corners = pitchCorners(105, 68, 90);
    expect(haversine(corners[0], corners[2])).toBeCloseTo(Math.hypot(105, 68), 0);
  });
});
