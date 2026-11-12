/**
 * Deterministic synthetic GPS data for tests. These are made-up tracks on a
 * made-up pitch: they are never shown in the app or presented as anyone's
 * real recording.
 */

import { createTransform, type Corners, type PitchCalibration } from "@/lib/gps/calibration";
import { localProjection } from "@/lib/gps/geo";
import type { LatLon, PitchPoint } from "@/lib/gps/types";

/** An arbitrary open field used only by tests. */
export const TEST_ORIGIN: LatLon = { lat: 51.5, lon: -0.12 };
export const TEST_START = Date.UTC(2026, 9, 4, 10, 0, 0);

/** Corners of a length × width pitch centred on `centre`, rotated so the attack bears `bearingDeg` from north. */
export function pitchCorners(length: number, width: number, bearingDeg = 90, centre: LatLon = TEST_ORIGIN): Corners {
  const projection = localProjection(centre);
  const theta = ((90 - bearingDeg) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const local: PitchPoint[] = [
    { x: 0, y: 0 },
    { x: length, y: 0 },
    { x: length, y: width },
    { x: 0, y: width },
  ];
  return local.map((point) => {
    const qx = point.x - length / 2;
    const qy = -(point.y - width / 2);
    return projection.inverse(qx * cos - qy * sin, qx * sin + qy * cos);
  }) as Corners;
}

export function testCalibration(length = 105, width = 68, bearingDeg = 90, centre: LatLon = TEST_ORIGIN): PitchCalibration {
  return { version: 1, corners: pitchCorners(length, width, bearingDeg, centre), length, width, preset: "custom", cornerSource: "entered" };
}

export interface SyntheticSample {
  t: number;
  lat: number;
  lon: number;
  hr?: number;
  distance?: number;
}

/** Samples a pitch path every `stepS` seconds for `seconds`, converted to lat/lon through `calibration`. */
export function samplePath(
  path: (seconds: number) => PitchPoint,
  { seconds, stepS = 1, start = TEST_START, calibration = testCalibration(), hr }: {
    seconds: number;
    stepS?: number;
    start?: number;
    calibration?: PitchCalibration;
    hr?: (seconds: number) => number;
  },
): SyntheticSample[] {
  const transform = createTransform(calibration);
  const samples: SyntheticSample[] = [];
  for (let s = 0; s <= seconds + 1e-9; s += stepS) {
    const position = transform.fromPitch(path(s));
    samples.push({ t: start + Math.round(s * 1000), ...position, ...(hr ? { hr: hr(s) } : {}) });
  }
  return samples;
}

const iso = (t: number) => new Date(t).toISOString();

export function toGpx(segments: SyntheticSample[][], { version = "1.1" }: { version?: "1.0" | "1.1" } = {}) {
  const points = (segment: SyntheticSample[]) =>
    segment
      .map(
        (s) =>
          `<trkpt lat="${s.lat.toFixed(7)}" lon="${s.lon.toFixed(7)}"><ele>12.5</ele><time>${iso(s.t)}</time>${
            s.hr === undefined ? "" : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(s.hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
          }</trkpt>`,
      )
      .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="${version}" creator="Synthetic test generator" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<trk><name>Synthetic</name><type>soccer</type>${segments.map((segment) => `<trkseg>${points(segment)}</trkseg>`).join("")}</trk>
</gpx>`;
}

export function toTcx(laps: SyntheticSample[][][]) {
  const trackpoint = (s: SyntheticSample) =>
    `<Trackpoint><Time>${iso(s.t)}</Time><Position><LatitudeDegrees>${s.lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${s.lon.toFixed(7)}</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters>${
      s.distance === undefined ? "" : `<DistanceMeters>${s.distance.toFixed(1)}</DistanceMeters>`
    }${s.hr === undefined ? "" : `<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>`}</Trackpoint>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Other"><Id>${iso(laps[0][0][0].t)}</Id>
${laps
  .map(
    (tracks) =>
      `<Lap StartTime="${iso(tracks[0][0].t)}"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1000</DistanceMeters>${tracks
        .map((track) => `<Track>${track.map(trackpoint).join("")}</Track>`)
        .join("")}</Lap>`,
  )
  .join("")}
<Creator><Name>Synthetic Watch</Name></Creator></Activity></Activities>
</TrainingCenterDatabase>`;
}

export const encode = (text: string) => new TextEncoder().encode(text);

/** A pseudo-random generator with a fixed seed, so "noise" is identical on every run. */
export function seeded(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
