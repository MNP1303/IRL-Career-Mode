import { DEFAULT_LIMITS, GpsImportError, type ImportLimits } from "@/lib/gps/errors";
import { looksLikeFit, parseFit } from "@/lib/gps/parsers/fit";
import { parseGpx } from "@/lib/gps/parsers/gpx";
import { parseTcx } from "@/lib/gps/parsers/tcx";
import { decodeText, rootElementName } from "@/lib/gps/parsers/xml";
import type { NormalisedActivity, SourceFormat } from "@/lib/gps/types";

export const ACCEPTED_EXTENSIONS = [".gpx", ".fit", ".tcx"] as const;

/**
 * Works out the format from the file's contents. The extension and MIME
 * type are never trusted: a FIT file is recognised by its binary header, and
 * GPX/TCX by their XML root element.
 */
export function detectFormat(bytes: Uint8Array): SourceFormat | "empty" | "unknown" {
  if (bytes.length === 0) return "empty";
  if (looksLikeFit(bytes)) return "fit";
  const head = decodeText(bytes.subarray(0, 64 * 1024));
  if (!head.trim()) return "empty";
  const root = rootElementName(head);
  if (root === "gpx") return "gpx";
  if (root === "TrainingCenterDatabase") return "tcx";
  return "unknown";
}

export function parseActivity(bytes: Uint8Array, limits: ImportLimits = DEFAULT_LIMITS): NormalisedActivity {
  if (bytes.byteLength > limits.maxBytes) {
    throw new GpsImportError(
      "limit_exceeded",
      `The file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(limits.maxBytes / 1024 / 1024)} MB.`,
    );
  }
  const format = detectFormat(bytes);
  switch (format) {
    case "empty":
      throw new GpsImportError("empty_file", "The file has no content.");
    case "fit":
      return parseFit(bytes, limits);
    case "gpx":
      return parseGpx(decodeText(bytes), bytes.byteLength, limits);
    case "tcx":
      return parseTcx(decodeText(bytes), bytes.byteLength, limits);
    default:
      throw new GpsImportError(
        "unsupported_format",
        "Only GPX, TCX and FIT activity files are supported. This file's contents don't match any of them.",
      );
  }
}
