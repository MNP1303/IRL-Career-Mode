import { readFileSync } from "node:fs";
import path from "node:path";
import { Encoder, Profile, type Mesg } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { fileSource } from "@/lib/gps/adapter";
import { DEFAULT_LIMITS, GpsImportError, type GpsErrorCode } from "@/lib/gps/errors";
import { detectFormat, parseActivity } from "@/lib/gps/parse";
import { encode, samplePath, TEST_START, toGpx, toTcx } from "@/lib/gps/testing/synthetic";

const FIT_FIXTURE = path.resolve(import.meta.dirname, "__fixtures__/synthetic-activity.fit");

function expectCode(run: () => unknown, code: GpsErrorCode) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GpsImportError);
    expect((error as GpsImportError).code).toBe(code);
    return;
  }
  throw new Error(`Expected a ${code} error`);
}

const walk = (seconds: number, start = TEST_START) =>
  samplePath((s) => ({ x: 10 + s * 0.5, y: 30 }), { seconds, start, hr: (s) => 120 + s / 10 });

describe("format detection", () => {
  it("reads the structure, not the extension", () => {
    expect(detectFormat(encode(toGpx([walk(10)])))).toBe("gpx");
    expect(detectFormat(encode(toTcx([[walk(10)]])))).toBe("tcx");
    expect(detectFormat(new Uint8Array(readFileSync(FIT_FIXTURE)))).toBe("fit");
    expect(detectFormat(encode("lat,lon\n51.5,-0.12"))).toBe("unknown");
    expect(detectFormat(encode("<kml></kml>"))).toBe("unknown");
    expect(detectFormat(new Uint8Array())).toBe("empty");
    expect(detectFormat(encode("   \n "))).toBe("empty");
  });

  it("skips declarations and comments before the root element", () => {
    const gpx = `﻿<?xml version="1.0"?>\n<!-- exported -->\n<gpx version="1.1"><trk><trkseg></trkseg></trk></gpx>`;
    expect(detectFormat(encode(gpx))).toBe("gpx");
  });
});

describe("GPX", () => {
  it("keeps segments apart and reads elevation and heart rate", () => {
    const activity = parseActivity(encode(toGpx([walk(60), walk(60, TEST_START + 600_000)])));
    expect(activity.segments).toHaveLength(2);
    expect(activity.pointCount).toBe(122);
    expect(activity.segments[0].points[0].ele).toBe(12.5);
    expect(activity.channels.heartRate).toBe(true);
    expect(activity.heartRate[0].bpm).toBe(120);
    expect(activity.provenance).toMatchObject({ format: "gpx", formatVersion: "1.1", sport: "soccer" });
    expect(activity.startTime).toBe(TEST_START);
  });

  it("reads GPX 1.0 with <speed> on the point", () => {
    const text = `<?xml version="1.0"?><gpx version="1.0" creator="t"><trk><trkseg>
      <trkpt lat="51.5" lon="-0.12"><time>2026-10-04T10:00:00Z</time><speed>2.5</speed></trkpt>
      <trkpt lat="51.50001" lon="-0.12"><time>2026-10-04T10:00:01Z</time><speed>2.6</speed></trkpt>
    </trkseg></trk></gpx>`;
    const activity = parseActivity(encode(text));
    expect(activity.provenance.formatVersion).toBe("1.0");
    expect(activity.segments[0].points[1].speed).toBe(2.6);
    expect(activity.channels.heartRate).toBe(false);
  });

  it("never invents missing values and counts skipped records", () => {
    const text = `<gpx version="1.1"><trk><trkseg>
      <trkpt lat="51.5" lon="-0.12"><time>2026-10-04T10:00:00Z</time></trkpt>
      <trkpt lat="51.5" lon="-0.12"></trkpt>
      <trkpt lat="95" lon="-0.12"><time>2026-10-04T10:00:02Z</time></trkpt>
      <trkpt lat="0" lon="0"><time>2026-10-04T10:00:03Z</time></trkpt>
      <trkpt lat="51.50002" lon="-0.12"><time>2026-10-04T10:00:04Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const activity = parseActivity(encode(text));
    expect(activity.pointCount).toBe(2);
    expect(activity.skipped).toEqual({ "missing-time": 1, "invalid-coordinates": 2 });
    expect(activity.segments[0].points[0]).toEqual({ t: Date.parse("2026-10-04T10:00:00Z"), lat: 51.5, lon: -0.12 });
  });

  it("rejects DTDs and entities (no XXE or entity expansion)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx version="1.1"><trk><name>&x;</name></trk></gpx>`;
    expectCode(() => parseActivity(encode(xxe)), "unsupported_format");
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><gpx>&lol2;</gpx>`;
    expectCode(() => parseActivity(encode(bomb)), "unsupported_format");
  });

  it("explains each failure clearly", () => {
    expectCode(() => parseActivity(new Uint8Array()), "empty_file");
    expectCode(() => parseActivity(encode("hello")), "unsupported_format");
    expectCode(() => parseActivity(encode(`<gpx version="1.1"><trk><trkseg><trkpt lat="1"`)), "corrupted_file");
    expectCode(() => parseActivity(encode(`<gpx version="1.1"><wpt lat="51" lon="0"/></gpx>`)), "no_gps");
    expectCode(
      () => parseActivity(encode(`<gpx version="1.1"><trk><trkseg><trkpt lat="51.5" lon="-0.1"/><trkpt lat="51.5" lon="-0.1"/></trkseg></trk></gpx>`)),
      "no_timestamps",
    );
    expectCode(
      () => parseActivity(encode(`<gpx version="1.1"><trk><trkseg><trkpt lat="200" lon="-0.1"><time>2026-10-04T10:00:00Z</time></trkpt></trkseg></trk></gpx>`)),
      "invalid_coordinates",
    );
  });

  it("enforces size, record and duration limits", () => {
    const bytes = encode(toGpx([walk(30)]));
    expectCode(() => parseActivity(bytes, { ...DEFAULT_LIMITS, maxBytes: 100 }), "limit_exceeded");
    expectCode(() => parseActivity(bytes, { ...DEFAULT_LIMITS, maxRecords: 10 }), "limit_exceeded");
    const long = encode(toGpx([walk(5), walk(5, TEST_START + 13 * 3_600_000)]));
    expectCode(() => parseActivity(long), "limit_exceeded");
  });
});

describe("TCX", () => {
  it("keeps each track separate, reads distance, heart rate and lap totals", () => {
    const lapOne = [walk(30).map((s, i) => ({ ...s, distance: i * 0.5 }))];
    const lapTwo = [walk(30, TEST_START + 300_000).map((s, i) => ({ ...s, distance: 100 + i * 0.5 })), walk(10, TEST_START + 400_000)];
    const activity = parseActivity(encode(toTcx([lapOne, lapTwo])));
    expect(activity.segments).toHaveLength(3);
    expect(activity.segments[0].source).toBe("tcx-track");
    expect(activity.segments[0].points[4].distance).toBe(2);
    expect(activity.channels.distance).toBe(true);
    expect(activity.deviceTotals).toEqual({ distance: 2000, timerSeconds: 1200 });
    expect(activity.provenance.creator).toBe("Synthetic Watch");
  });

  it("keeps heart rate from trackpoints that have no position", () => {
    const text = `<TrainingCenterDatabase><Activities><Activity Sport="Other"><Lap><Track>
      <Trackpoint><Time>2026-10-04T10:00:00Z</Time><HeartRateBpm><Value>101</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2026-10-04T10:00:01Z</Time><Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const activity = parseActivity(encode(text));
    expect(activity.heartRate).toEqual([{ t: Date.parse("2026-10-04T10:00:00Z"), bpm: 101 }]);
    expect(activity.pointCount).toBe(1);
    expect(activity.skipped["missing-position"]).toBe(1);
  });
});

describe("FIT", () => {
  it("decodes the committed fixture (a real FIT binary from Garmin's encoder)", async () => {
    const bytes = new Uint8Array(readFileSync(FIT_FIXTURE));
    const imported = await fileSource.load(bytes);
    const { activity } = imported;
    expect(imported.format).toBe("fit");
    expect(imported.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Timer stop/start splits the recording; nothing joins across the pause.
    expect(activity.segments).toHaveLength(2);
    expect(activity.pointCount).toBe(601 + 481);
    // The first 30 s had heart rate but no fix: kept as heart rate, never as positions.
    expect(activity.skipped["missing-position"]).toBe(30);
    expect(activity.heartRate[0]).toEqual({ t: TEST_START, bpm: 95 });
    const first = activity.segments[0].points[0];
    expect(first.t).toBe(TEST_START + 30_000);
    expect(first.lat).toBeCloseTo(51.5, 3);
    expect(first.lon).toBeCloseTo(-0.12, 3);
    expect(first.accuracy).toBe(4);
    expect(first.speed).toBeCloseTo(1.9, 2);
    expect(activity.channels).toMatchObject({ distance: true, accuracy: true, heartRate: true, elevation: true });
    expect(activity.deviceTotals?.timerSeconds).toBe(1110);
    expect(activity.provenance.sport).toBe("soccer");
  });

  it("does not assume GPS is present", () => {
    const encoder = new Encoder();
    encoder.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", product: 1, timeCreated: new Date(TEST_START) } as Mesg);
    for (let s = 0; s < 20; s += 1) encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: new Date(TEST_START + s * 1000), heartRate: 120 } as Mesg);
    expectCode(() => parseActivity(encoder.close()), "no_gps");
  });

  it("rejects a damaged FIT file", () => {
    const bytes = new Uint8Array(readFileSync(FIT_FIXTURE));
    bytes[bytes.length - 40] ^= 0xff;
    expectCode(() => parseActivity(bytes), "corrupted_file");
    expectCode(() => parseActivity(bytes.subarray(0, 200)), "corrupted_file");
  });
});
