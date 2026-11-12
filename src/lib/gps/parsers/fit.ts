import { Decoder, Profile, Stream } from "@garmin/fitsdk";
import { DEFAULT_LIMITS, GpsImportError, type ImportLimits } from "@/lib/gps/errors";
import { ActivityBuilder, PARSER_VERSION } from "@/lib/gps/parsers/builder";
import type { DeviceTotals, NormalisedActivity } from "@/lib/gps/types";

/** FIT stores positions as semicircles: 2^31 of them make 180 degrees. */
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

const MESG = {
  fileId: Profile.MesgNum.FILE_ID,
  session: Profile.MesgNum.SESSION,
  record: Profile.MesgNum.RECORD,
  event: Profile.MesgNum.EVENT,
} as const;

type FitValue = string | number | boolean | Date | undefined | null | unknown[];
type FitMesg = Record<string, FitValue>;

const num = (value: FitValue) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const time = (value: FitValue) => (value instanceof Date ? value.getTime() : undefined);

/** True when the bytes carry a FIT file header (".FIT" signature). */
export function looksLikeFit(bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) return false;
  return bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

/**
 * Garmin FIT activity files, decoded with Garmin's official FIT SDK
 * (`@garmin/fitsdk`). Records without a position (indoor activities, HR-only
 * samples before a fix) keep their heart rate but add no point. Timer
 * stop/start events split the recording into separate segments.
 */
export function parseFit(bytes: Uint8Array, limits: ImportLimits = DEFAULT_LIMITS): NormalisedActivity {
  const stream = Stream.fromByteArray(bytes);
  if (!Decoder.isFIT(stream)) {
    throw new GpsImportError("unsupported_format", "This isn't a FIT file: the header is missing its FIT signature.");
  }
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    throw new GpsImportError("corrupted_file", "The FIT file failed its checksum. It may be incomplete or damaged; try exporting it again.");
  }

  const builder = new ActivityBuilder(limits);
  const notes: string[] = [];
  const totals: DeviceTotals = {};
  let sport: string | undefined;
  let creator: string | undefined;
  let fileType: string | undefined;
  let timerRunning = true;
  let records = 0;
  builder.startSegment("fit-timer");

  let listenerError: unknown = null;
  const { errors, profileVersion } = decoder.read({
    applyScaleAndOffset: true,
    expandComponents: true,
    expandSubFields: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
    includeUnknownData: false,
    mesgListener: (mesgNum, raw) => {
      if (listenerError) return;
      const mesg = raw as unknown as FitMesg;
      try {
        if (mesgNum === MESG.record) {
          records += 1;
          const lat = num(mesg.positionLat);
          const lon = num(mesg.positionLong);
          builder.add({
            t: time(mesg.timestamp),
            lat: lat === undefined ? undefined : lat * SEMICIRCLES_TO_DEGREES,
            lon: lon === undefined ? undefined : lon * SEMICIRCLES_TO_DEGREES,
            ele: num(mesg.enhancedAltitude) ?? num(mesg.altitude),
            hr: num(mesg.heartRate),
            accuracy: num(mesg.gpsAccuracy),
            distance: num(mesg.distance),
            speed: num(mesg.enhancedSpeed) ?? num(mesg.speed),
          });
        } else if (mesgNum === MESG.event && mesg.event === "timer") {
          const type = mesg.eventType;
          if (type === "start" && !timerRunning) {
            builder.startSegment("fit-timer");
            timerRunning = true;
          } else if ((type === "stop" || type === "stopAll" || type === "stopDisable" || type === "stopDisableAll") && timerRunning) {
            builder.endSegment();
            timerRunning = false;
          }
        } else if (mesgNum === MESG.session) {
          if (!sport && typeof mesg.sport === "string") sport = mesg.sport;
          const distance = num(mesg.totalDistance);
          const elapsed = num(mesg.totalElapsedTime);
          const timer = num(mesg.totalTimerTime);
          if (distance !== undefined) totals.distance = (totals.distance ?? 0) + distance;
          if (elapsed !== undefined) totals.elapsedSeconds = (totals.elapsedSeconds ?? 0) + elapsed;
          if (timer !== undefined) totals.timerSeconds = (totals.timerSeconds ?? 0) + timer;
        } else if (mesgNum === MESG.fileId) {
          fileType = typeof mesg.type === "string" ? mesg.type : fileType;
          const manufacturer = typeof mesg.manufacturer === "string" ? mesg.manufacturer : undefined;
          const product = typeof mesg.garminProduct === "string" ? mesg.garminProduct : typeof mesg.productName === "string" ? mesg.productName : undefined;
          creator = [manufacturer, product].filter(Boolean).join(" ").slice(0, 120) || creator;
        }
      } catch (error) {
        listenerError = error;
      }
    },
  });
  if (listenerError) throw listenerError;

  if (errors.length && records === 0) {
    throw new GpsImportError("corrupted_file", "The FIT file couldn't be decoded. It may be damaged; try exporting it again.");
  }
  if (errors.length) notes.push("Part of the FIT file couldn't be decoded; everything before that point was read.");
  if (fileType && fileType !== "activity") {
    if (records === 0) {
      throw new GpsImportError("no_gps", `This is a FIT ${fileType} file, not an activity recording.`);
    }
    notes.push(`The FIT file type is "${fileType}", not "activity".`);
  }

  return builder.finish(
    {
      provider: "file",
      format: "fit",
      creator,
      formatVersion: `FIT profile ${profileVersion.major}.${profileVersion.minor}`,
      sport,
      byteSize: bytes.byteLength,
      parserVersion: PARSER_VERSION,
      notes,
    },
    Object.keys(totals).length ? totals : undefined,
  );
}
