import { DEFAULT_LIMITS, GpsImportError, type ImportLimits } from "@/lib/gps/errors";
import { ActivityBuilder, asArray, PARSER_VERSION, parseXmlTime, toNumber } from "@/lib/gps/parsers/builder";
import { parseXml } from "@/lib/gps/parsers/xml";
import type { NormalisedActivity } from "@/lib/gps/types";

type Node = Record<string, unknown>;

const child = (node: unknown, key: string): unknown =>
  node && typeof node === "object" ? (node as Node)[key] : undefined;

/**
 * Heart rate and speed live in extensions that vary by app. Namespace
 * prefixes are already stripped, so Garmin's `gpxtpx:TrackPointExtension/hr`,
 * `gpxdata:hr` and a bare `hr` all read the same way.
 */
function extensionValue(extensions: unknown, keys: string[]): number | undefined {
  if (!extensions || typeof extensions !== "object") return undefined;
  const queue: unknown[] = [extensions];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node as Node)) {
      if (keys.includes(key.toLowerCase())) {
        const number = toNumber(value);
        if (number !== undefined && Number.isFinite(number)) return number;
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }
  return undefined;
}

/** GPX 1.0 and 1.1: tracks, segments, elevation and heart-rate extensions. */
export function parseGpx(text: string, byteSize: number, limits: ImportLimits = DEFAULT_LIMITS): NormalisedActivity {
  const document = parseXml(text);
  const gpx = document.gpx as Node | undefined;
  if (!gpx || typeof gpx !== "object") {
    throw new GpsImportError("unsupported_format", "This isn't a GPX file: its root element isn't <gpx>.");
  }
  const version = typeof gpx.version === "string" ? gpx.version : undefined;
  const notes: string[] = [];
  if (version && version !== "1.0" && version !== "1.1") notes.push(`GPX version ${version} was read as GPX 1.1.`);

  const builder = new ActivityBuilder(limits);
  let sport: string | undefined;
  let sawHdop = false;

  for (const track of asArray(gpx.trk as Node[])) {
    if (!sport && typeof child(track, "type") === "string") sport = child(track, "type") as string;
    for (const segment of asArray(child(track, "trkseg") as Node[])) {
      builder.startSegment("trkseg");
      for (const point of asArray(child(segment, "trkpt") as Node[])) {
        if (!point || typeof point !== "object") continue;
        const extensions = child(point, "extensions");
        if (child(point, "hdop") !== undefined) sawHdop = true;
        builder.add({
          t: parseXmlTime(child(point, "time")),
          lat: toNumber(child(point, "lat")),
          lon: toNumber(child(point, "lon")),
          ele: toNumber(child(point, "ele")),
          hr: extensionValue(extensions, ["hr", "heartrate"]),
          // GPX 1.0 has <speed> on the point; GPX 1.1 apps put it in extensions.
          speed: toNumber(child(point, "speed")) ?? extensionValue(extensions, ["speed"]),
        });
      }
      builder.endSegment();
    }
  }
  if (sawHdop) {
    notes.push("The file has HDOP values. HDOP is a dilution factor, not metres, so it isn't used as accuracy.");
  }

  return builder.finish({
    provider: "file",
    format: "gpx",
    creator: typeof gpx.creator === "string" ? gpx.creator.slice(0, 120) : undefined,
    formatVersion: version ?? "1.1",
    sport,
    byteSize,
    parserVersion: PARSER_VERSION,
    notes,
  });
}
