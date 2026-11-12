import { describe, expect, it } from "vitest";
import { MemoryBackend } from "@/lib/gps/backends/memory";
import { parseActivity } from "@/lib/gps/parse";
import { processTracking } from "@/lib/gps/pipeline";
import { screenActivity } from "@/lib/gps/screen";
import { checkDuplicate, cleanupOrphans, ORPHAN_GRACE_MS, removeTracking, saveTracking, type PendingImport } from "@/lib/gps/service";
import { sha256Hex } from "@/lib/gps/fingerprint";
import { checkIntervals, intervalsFromSegments, playingTimeMs } from "@/lib/gps/trim";
import { encode, samplePath, testCalibration, TEST_START, toGpx } from "@/lib/gps/testing/synthetic";
import { buildSampleMatches } from "@/lib/sample-data";
import { computeCareer } from "@/lib/engine/career";

async function makeImport(offsetMs = 0, extra = 0) {
  const calibration = testCalibration();
  const samples = samplePath((s) => ({ x: 52.5 + 30 * Math.cos(s / 50), y: 34 + 20 * Math.sin(s / 50) + extra }), {
    seconds: 25 * 60,
    start: TEST_START + offsetMs,
    calibration,
  });
  const bytes = encode(toGpx([samples]));
  const activity = parseActivity(bytes);
  const screen = screenActivity(activity);
  const result = processTracking({ activity, screen, intervals: [{ start: activity.startTime, end: activity.endTime }], calibration });
  const pending: PendingImport = { fingerprint: await sha256Hex(bytes), format: "gpx", fileName: "match.gpx", bytes, activity };
  return { pending, result };
}

describe("GPS persistence rules", () => {
  it("attaches, then reports an exact duplicate instead of overwriting", async () => {
    const backend = new MemoryBackend({ matches: ["m-1", "m-2"] });
    const { pending, result } = await makeImport();
    expect(await checkDuplicate(backend, pending)).toBeNull();
    const saved = await saveTracking(backend, { matchId: "m-1", pending, result });
    expect(backend.files.size).toBe(1);
    const duplicate = await checkDuplicate(backend, pending);
    expect(duplicate?.match.kind).toBe("exact");
    expect(duplicate?.attachedTo).toEqual(["m-1"]);
    expect(saved.importId).toBe(duplicate?.match.existing.id);
  });

  it("spots the same activity exported as a different file", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const first = await makeImport();
    await saveTracking(backend, { matchId: "m-1", pending: first.pending, result: first.result });
    // A re-export: different bytes, same times and point count.
    const second = await makeImport(0, 0.0001);
    const duplicate = await checkDuplicate(backend, second.pending);
    expect(duplicate?.match.kind).toBe("likely");
    // A different day is not a duplicate.
    const later = await makeImport(86_400_000);
    expect(await checkDuplicate(backend, later.pending)).toBeNull();
  });

  it("replaces an import and removes the old file nothing uses", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const first = await makeImport();
    const second = await makeImport(86_400_000);
    await saveTracking(backend, { matchId: "m-1", pending: first.pending, result: first.result });
    const track = await backend.getActiveTrack("m-1");
    await backend.setHeatmapSource(track!.id, "manual");
    const replaced = await saveTracking(backend, { matchId: "m-1", pending: second.pending, result: second.result });
    expect(backend.imports.size).toBe(1);
    expect(backend.files.size).toBe(1);
    expect([...backend.imports.keys()]).toEqual([replaced.importId]);
    // The player's choice of heatmap source survives a replace.
    expect((await backend.getActiveTrack("m-1"))?.heatmapSource).toBe("manual");
  });

  it("recalibrating re-uses the stored file", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const { pending, result } = await makeImport();
    const first = await saveTracking(backend, { matchId: "m-1", pending, result });
    const again = await saveTracking(backend, { matchId: "m-1", pending, result: { ...result, intervals: result.intervals } });
    expect(again.importId).toBe(first.importId);
    expect(backend.files.size).toBe(1);
    expect(backend.tracks.size).toBe(1);
  });

  it("removes GPS data without touching the match", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const { pending, result } = await makeImport();
    await saveTracking(backend, { matchId: "m-1", pending, result });
    expect(await removeTracking(backend, "m-1")).toBe(true);
    expect(backend.tracks.size).toBe(0);
    expect(backend.imports.size).toBe(0);
    expect(backend.files.size).toBe(0);
    expect(backend.matches.has("m-1")).toBe(true);
  });

  it("refuses matches that aren't saved, and insufficient recordings", async () => {
    const backend = new MemoryBackend({ matches: [] });
    const { pending, result } = await makeImport();
    await expect(saveTracking(backend, { matchId: "m-x", pending, result })).rejects.toThrow(/Match not found/);
    expect(backend.files.size).toBe(0);
    await expect(
      saveTracking(new MemoryBackend({ matches: ["m-1"] }), { matchId: "m-1", pending, result: { ...result, quality: { ...result.quality, level: "insufficient" } } }),
    ).rejects.toThrow(/isn't good enough/);
  });

  it("cleans up the upload when saving the import row fails", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    backend.failing.add("insertImport");
    const { pending, result } = await makeImport();
    await expect(saveTracking(backend, { matchId: "m-1", pending, result })).rejects.toThrow();
    expect(backend.files.size).toBe(0);
    expect(backend.imports.size).toBe(0);
  });

  it("cleans up the import and file when attaching fails, keeping the old track", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const first = await makeImport();
    await saveTracking(backend, { matchId: "m-1", pending: first.pending, result: first.result });
    backend.failing.add("attachTrack");
    const second = await makeImport(86_400_000);
    await expect(saveTracking(backend, { matchId: "m-1", pending: second.pending, result: second.result })).rejects.toThrow();
    expect(backend.imports.size).toBe(1);
    expect(backend.files.size).toBe(1);
    expect((await backend.getActiveTrack("m-1"))?.importId).toBe([...backend.imports.keys()][0]);
  });

  it("removes leftovers after interrupted saves and deleted matches", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"] });
    const { pending, result } = await makeImport();
    await saveTracking(backend, { matchId: "m-1", pending, result });
    // A file whose row never got written, and a match deleted on the server (cascade).
    backend.files.set("dead-beef.gpx", new Uint8Array([1]));
    backend.deleteMatch("m-1");
    expect(backend.tracks.size).toBe(0);
    // Inside the grace period the unattached import is left alone (it could be mid-save).
    await cleanupOrphans(backend);
    expect(backend.imports.size).toBe(1);
    expect(backend.files.has("dead-beef.gpx")).toBe(false);
    await cleanupOrphans(backend, { now: Date.now() + ORPHAN_GRACE_MS + 1 });
    expect(backend.imports.size).toBe(0);
    expect(backend.files.size).toBe(0);
  });

  it("prunes tracks of deleted matches in browser storage", async () => {
    const backend = new MemoryBackend({ matches: ["m-1"], kind: "local" });
    const { pending, result } = await makeImport();
    await saveTracking(backend, { matchId: "m-1", pending, result });
    backend.deleteMatch("m-1");
    await cleanupOrphans(backend, { knownMatchIds: new Set(), now: Date.now() + ORPHAN_GRACE_MS + 1 });
    expect(backend.tracks.size + backend.imports.size + backend.files.size).toBe(0);
  });

  it("never feeds GPS into career progression", () => {
    // The career is a pure replay of the match log; GPS lives outside Match records.
    const matches = buildSampleMatches();
    const before = computeCareer(matches, "CM");
    const after = computeCareer(structuredClone(matches), "CM");
    expect(after.attributes).toEqual(before.attributes);
    expect(after.ovr).toEqual(before.ovr);
    expect(Object.keys(matches[0])).not.toContain("gps");
  });
});

describe("trimming", () => {
  const activity = { startTime: TEST_START, endTime: TEST_START + 3_600_000 };

  it("accepts any number of intervals and never assumes halves", () => {
    const intervals = [
      { start: TEST_START + 600_000, end: TEST_START + 1_200_000 },
      { start: TEST_START + 1_500_000, end: TEST_START + 1_800_000 },
      { start: TEST_START + 2_000_000, end: TEST_START + 3_000_000 },
    ];
    const check = checkIntervals(intervals, activity);
    expect(check.ok).toBe(true);
    expect(playingTimeMs(check.intervals)).toBe(600_000 + 300_000 + 1_000_000);
  });

  it("reports overlaps, inverted and out-of-range intervals rather than fixing them", () => {
    const check = checkIntervals(
      [
        { start: TEST_START + 100, end: TEST_START + 500_000 },
        { start: TEST_START + 400_000, end: TEST_START + 900_000 },
        { start: TEST_START + 2_000_000, end: TEST_START + 1_000_000 },
        { start: TEST_START + 5_000_000, end: TEST_START + 6_000_000 },
      ],
      activity,
    );
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toMatch(/overlaps/);
    expect(check.errors.join(" ")).toMatch(/ends before it starts/);
    expect(check.errors.join(" ")).toMatch(/outside the recording/);
    expect(checkIntervals([], activity).ok).toBe(false);
  });

  it("uses playing time for metrics and keeps the original timestamps", () => {
    const calibration = testCalibration();
    const warmUp = samplePath((s) => ({ x: -30, y: 10 + s * 0.01 }), { seconds: 600, calibration });
    const firstSpell = samplePath((s) => ({ x: 30 + 20 * Math.sin(s / 40), y: 34 }), { seconds: 900, start: TEST_START + 601_000, calibration });
    const secondSpell = samplePath((s) => ({ x: 70 + 20 * Math.sin(s / 40), y: 34 }), { seconds: 900, start: TEST_START + 1_800_000, calibration });
    const activityParsed = parseActivity(encode(toGpx([warmUp, firstSpell, secondSpell])));
    const screen = screenActivity(activityParsed);
    const intervals = intervalsFromSegments(activityParsed).slice(1);
    const result = processTracking({ activity: activityParsed, screen, intervals, calibration });
    expect(result.intervals[0].start).toBe(TEST_START + 601_000);
    expect(result.metrics.playingTime.value).toBe(1800);
    expect(result.counts.outsideIntervals).toBe(601);
    expect(result.counts.excluded["off-pitch"] ?? 0).toBe(0);
    // The break between spells isn't joined: no time is counted across it.
    expect(result.metrics.trackedTime.value).toBe(1800);
  });

  it("turns positions through the centre spot when teams switch ends", () => {
    const calibration = testCalibration();
    const samples = [
      ...samplePath(() => ({ x: 20, y: 20 }), { seconds: 400, calibration }),
      ...samplePath(() => ({ x: 85, y: 48 }), { seconds: 400, start: TEST_START + 1_000_000, calibration }),
    ];
    const activityParsed = parseActivity(encode(toGpx([samples])));
    const screen = screenActivity(activityParsed);
    const result = processTracking({
      activity: activityParsed,
      screen,
      intervals: [
        { start: TEST_START, end: TEST_START + 400_000 },
        { start: TEST_START + 1_000_000, end: TEST_START + 1_400_000, switchedEnds: true },
      ],
      calibration,
    });
    // (85, 48) turned through the centre is (20, 20): all time in one spot.
    expect(result.zones.thirds[0].share).toBeCloseTo(1, 5);
    expect(result.zones.channels[0].share).toBeCloseTo(1, 5);
  });
});
