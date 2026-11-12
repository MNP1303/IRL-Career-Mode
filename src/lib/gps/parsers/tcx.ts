import { DEFAULT_LIMITS, GpsImportError, type ImportLimits } from "@/lib/gps/errors";
import { ActivityBuilder, asArray, PARSER_VERSION, parseXmlTime, toNumber } from "@/lib/gps/parsers/builder";
import { parseXml } from "@/lib/gps/parsers/xml";
import type { DeviceTotals, NormalisedActivity } from "@/lib/gps/types";

type Node = Record<string, unknown>;

const child = (node: unknown, key: string): unknown =>
  node && typeof node === "object" ? (node as Node)[key] : undefined;

function speedFromExtensions(extensions: unknown) {
  // <Extensions><ns3:TPX><ns3:Speed>…</ns3:Speed></ns3:TPX></Extensions>
  const tpx = child(extensions, "TPX");
  return toNumber(child(tpx, "Speed"));
}

/**
 * Garmin Training Center (TCX): trackpoints, heart rate, altitude, distance
 * and speed. Each <Track> is kept as its own segment: devices start a new
 * track after a pause, so joining them would draw a line across the break.
 */
export function parseTcx(text: string, byteSize: number, limits: ImportLimits = DEFAULT_LIMITS): NormalisedActivity {
  const document = parseXml(text);
  const root = document.TrainingCenterDatabase as Node | undefined;
  if (!root || typeof root !== "object") {
    throw new GpsImportError("unsupported_format", "This isn't a TCX file: its root element isn't <TrainingCenterDatabase>.");
  }
  const activities = asArray(child(child(root, "Activities"), "Activity") as Node[]);
  if (!activities.length) {
    throw new GpsImportError("no_gps", "The TCX file has no activities. Course and workout files aren't supported.");
  }
  const notes: string[] = [];
  if (activities.length > 1) notes.push(`The file has ${activities.length} activities; all were read in time order.`);

  const builder = new ActivityBuilder(limits);
  const totals: DeviceTotals = {};
  let lapDistance = 0;
  let lapTime = 0;
  let lapsWithTotals = 0;
  let laps = 0;
  let sport: string | undefined;
  let creator: string | undefined;

  for (const activity of activities) {
    if (!sport && typeof activity.Sport === "string") sport = activity.Sport;
    const name = child(child(activity, "Creator"), "Name");
    if (!creator && typeof name === "string") creator = name.slice(0, 120);
    for (const lap of asArray(child(activity, "Lap") as Node[])) {
      laps += 1;
      const distance = toNumber(child(lap, "DistanceMeters"));
      const seconds = toNumber(child(lap, "TotalTimeSeconds"));
      if (distance !== undefined && Number.isFinite(distance) && seconds !== undefined && Number.isFinite(seconds)) {
        lapDistance += distance;
        lapTime += seconds;
        lapsWithTotals += 1;
      }
      for (const track of asArray(child(lap, "Track") as Node[])) {
        builder.startSegment("tcx-track");
        for (const point of asArray(child(track, "Trackpoint") as Node[])) {
          const position = child(point, "Position");
          builder.add({
            t: parseXmlTime(child(point, "Time")),
            lat: toNumber(child(position, "LatitudeDegrees")),
            lon: toNumber(child(position, "LongitudeDegrees")),
            ele: toNumber(child(point, "AltitudeMeters")),
            distance: toNumber(child(point, "DistanceMeters")),
            hr: toNumber(child(child(point, "HeartRateBpm"), "Value")),
            speed: speedFromExtensions(child(point, "Extensions")),
          });
        }
        builder.endSegment();
      }
    }
  }
  // Device totals only count when every lap reported them.
  if (laps > 0 && lapsWithTotals === laps) {
    totals.distance = lapDistance;
    totals.timerSeconds = lapTime;
  }

  return builder.finish(
    {
      provider: "file",
      format: "tcx",
      creator,
      formatVersion: "TCX v2",
      sport,
      byteSize,
      parserVersion: PARSER_VERSION,
      notes,
    },
    Object.keys(totals).length ? totals : undefined,
  );
}
