// Writes src/lib/gps/__fixtures__/synthetic-activity.fit: a real FIT binary
// produced with Garmin's official encoder (@garmin/fitsdk), from a made-up,
// deterministic track. It is test data only, never shown as anyone's activity.
//
//   node scripts/gps/generate-fit-fixture.mjs
//
// The track: 30 s of heart-rate-only records before a GPS fix, then 10 min
// of jogging laps around a 105 × 68 m pitch at 1 Hz, a 2 min timer pause, and
// 8 more minutes. The pitch is centred at 51.5 N, 0.12 W with the attack
// running due east.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Encoder, Profile } from "@garmin/fitsdk";

const START = Date.UTC(2026, 9, 4, 10, 0, 0);
const CENTRE = { lat: 51.5, lon: -0.12 };
const LENGTH = 105;
const WIDTH = 68;

const phi = (CENTRE.lat * Math.PI) / 180;
const metresPerLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const metresPerLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const toSemicircles = (degrees) => Math.round((degrees * 2 ** 31) / 180);

/** Pitch metres (x towards the attack = east, y towards the right touchline = south) to lat/lon. */
function toLatLon(x, y) {
  const east = x - LENGTH / 2;
  const north = -(y - WIDTH / 2);
  return { lat: CENTRE.lat + north / metresPerLat, lon: CENTRE.lon + east / metresPerLon };
}

/** An ellipse inside the pitch, one lap every 120 s. */
function path(seconds) {
  const angle = (seconds / 120) * Math.PI * 2;
  return { x: LENGTH / 2 + Math.cos(angle) * 35, y: WIDTH / 2 + Math.sin(angle) * 20 };
}

const encoder = new Encoder();
encoder.onMesg(Profile.MesgNum.FILE_ID, {
  type: "activity",
  manufacturer: "development",
  product: 1,
  serialNumber: 12345,
  timeCreated: new Date(START),
});
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(START), event: "timer", eventType: "start" });

let distance = 0;
let previous = null;
const write = (second) => {
  const position = path(second);
  if (previous) distance += Math.hypot(position.x - previous.x, position.y - previous.y);
  previous = position;
  const { lat, lon } = toLatLon(position.x, position.y);
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: new Date(START + second * 1000),
    positionLat: toSemicircles(lat),
    positionLong: toSemicircles(lon),
    enhancedAltitude: 15,
    heartRate: 130 + Math.round(20 * Math.sin(second / 60)),
    distance,
    enhancedSpeed: 1.9,
    gpsAccuracy: 4,
  });
};

// Heart rate before the first GPS fix: no position fields at all.
for (let second = 0; second < 30; second += 1) {
  encoder.onMesg(Profile.MesgNum.RECORD, { timestamp: new Date(START + second * 1000), heartRate: 95 + second });
}
for (let second = 30; second <= 630; second += 1) write(second);
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(START + 630_000), event: "timer", eventType: "stopAll" });
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(START + 750_000), event: "timer", eventType: "start" });
previous = null;
for (let second = 750; second <= 1230; second += 1) write(second);
encoder.onMesg(Profile.MesgNum.EVENT, { timestamp: new Date(START + 1_230_000), event: "timer", eventType: "stopAll" });

encoder.onMesg(Profile.MesgNum.SESSION, {
  timestamp: new Date(START + 1_230_000),
  startTime: new Date(START),
  sport: "soccer",
  totalElapsedTime: 1230,
  totalTimerTime: 1110,
  totalDistance: distance,
});
encoder.onMesg(Profile.MesgNum.ACTIVITY, {
  timestamp: new Date(START + 1_230_000),
  numSessions: 1,
  type: "manual",
  event: "activity",
  eventType: "stop",
});

const out = fileURLToPath(new URL("../../src/lib/gps/__fixtures__/synthetic-activity.fit", import.meta.url));
writeFileSync(out, encoder.close());
console.log(`Wrote ${out}`);
