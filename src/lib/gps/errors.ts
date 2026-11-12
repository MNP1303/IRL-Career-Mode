/** Import limits and the errors a player can see. */

export interface ImportLimits {
  /** Largest accepted file, in bytes. */
  maxBytes: number;
  /** Most trackpoints/records read from one file. */
  maxRecords: number;
  /** Longest a parse may run before it gives up, in milliseconds. */
  maxParseMs: number;
  /** Longest activity accepted, in milliseconds. */
  maxDurationMs: number;
}

export const DEFAULT_LIMITS: ImportLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxRecords: 250_000,
  maxParseMs: 20_000,
  maxDurationMs: 12 * 60 * 60 * 1000,
};

export type GpsErrorCode =
  | "unsupported_format"
  | "corrupted_file"
  | "no_gps"
  | "no_timestamps"
  | "empty_file"
  | "invalid_coordinates"
  | "limit_exceeded"
  | "insufficient_data";

const TITLES: Record<GpsErrorCode, string> = {
  unsupported_format: "This file type isn't supported",
  corrupted_file: "This file looks damaged",
  no_gps: "No GPS positions in this file",
  no_timestamps: "This file has no timestamps",
  empty_file: "This file is empty",
  invalid_coordinates: "The positions in this file aren't valid",
  limit_exceeded: "This file is too large to process",
  insufficient_data: "Not enough data for a heatmap",
};

export class GpsImportError extends Error {
  readonly code: GpsErrorCode;
  readonly title: string;

  constructor(code: GpsErrorCode, message: string) {
    super(message);
    this.name = "GpsImportError";
    this.code = code;
    this.title = TITLES[code];
  }
}

export function isGpsImportError(error: unknown): error is GpsImportError {
  return error instanceof GpsImportError || (typeof error === "object" && error !== null && (error as { name?: string }).name === "GpsImportError");
}

/** Throws once a parse has run past its time budget. */
export function deadline(limits: ImportLimits) {
  const end = Date.now() + limits.maxParseMs;
  let calls = 0;
  return () => {
    // Checking the clock every call would dominate small loops.
    calls += 1;
    if (calls % 2048 === 0 && Date.now() > end) {
      throw new GpsImportError(
        "limit_exceeded",
        `Reading the file took longer than ${Math.round(limits.maxParseMs / 1000)} seconds, so it was stopped.`,
      );
    }
  };
}
