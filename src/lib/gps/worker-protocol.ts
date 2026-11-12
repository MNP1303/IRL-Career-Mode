/**
 * The work done in the GPS worker, written as plain functions so the same
 * code runs on the main thread when workers aren't available, and in tests.
 */

import { fileSource } from "@/lib/gps/adapter";
import type { PitchCalibration } from "@/lib/gps/calibration";
import { isGpsImportError } from "@/lib/gps/errors";
import { processTracking, ProcessingError, type TrackingResult } from "@/lib/gps/pipeline";
import { screenActivity, type ScreenResult } from "@/lib/gps/screen";
import type { PlayingInterval } from "@/lib/gps/trim";
import type { NormalisedActivity, SourceFormat } from "@/lib/gps/types";

export type WorkerRequest =
  | { id: number; type: "parse"; bytes: ArrayBuffer }
  | { id: number; type: "process"; session: string; intervals: PlayingInterval[]; calibration: PitchCalibration };

export interface ParsedFile {
  session: string;
  activity: NormalisedActivity;
  screen: ScreenResult;
  fingerprint: string;
  format: SourceFormat;
}

export interface WorkerFailure {
  kind: "import" | "processing" | "unexpected";
  code?: string;
  title: string;
  message: string;
}

export type WorkerResponse =
  | { id: number; ok: true; type: "parse"; parsed: ParsedFile }
  | { id: number; ok: true; type: "process"; result: TrackingResult }
  | { id: number; ok: false; error: WorkerFailure };

const sessions = new Map<string, { activity: NormalisedActivity; screen: ScreenResult }>();
let counter = 0;

function describe(error: unknown): WorkerFailure {
  if (isGpsImportError(error)) return { kind: "import", code: error.code, title: error.title, message: error.message };
  if (error instanceof ProcessingError) return { kind: "processing", title: "Can't build the heatmap yet", message: error.message };
  // Never echo raw values from the file back; a generic message is enough.
  return { kind: "unexpected", title: "Something went wrong", message: "The file couldn't be processed. Try exporting it again." };
}

export async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (request.type === "parse") {
      const imported = await fileSource.load(new Uint8Array(request.bytes));
      const screen = screenActivity(imported.activity);
      counter += 1;
      const session = `s${counter}`;
      // One file at a time is enough; drop older sessions to free memory.
      sessions.clear();
      sessions.set(session, { activity: imported.activity, screen });
      return { id: request.id, ok: true, type: "parse", parsed: { session, activity: imported.activity, screen, fingerprint: imported.fingerprint, format: imported.format } };
    }
    const session = sessions.get(request.session);
    if (!session) throw new ProcessingError(["The file is no longer loaded. Choose it again."]);
    const result = processTracking({ ...session, intervals: request.intervals, calibration: request.calibration });
    return { id: request.id, ok: true, type: "process", result };
  } catch (error) {
    return { id: request.id, ok: false, error: describe(error) };
  }
}
