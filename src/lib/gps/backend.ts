/**
 * Where GPS imports are kept. Two implementations share this interface:
 * - `account` (Supabase): signed-in players. Rows are owner-only under RLS,
 *   source files sit in a private bucket.
 * - `local` (IndexedDB): guests. Everything stays in this browser.
 * The service in `service.ts` holds the rules (duplicates, replace, cleanup)
 * and talks only to this interface, so it's tested with an in-memory backend.
 */

import type { PitchCalibration } from "@/lib/gps/calibration";
import type { StoredHeatmap, TrackingSummary } from "@/lib/gps/record";
import type { SourceFormat } from "@/lib/gps/types";

export interface ImportRow {
  id: string;
  fingerprint: string;
  format: SourceFormat;
  fileName: string | null;
  byteSize: number;
  startedAt: number;
  endedAt: number;
  pointCount: number;
  /** Provenance only (creator, sport, parser version). Never coordinates. */
  metadata: Record<string, string | number>;
  createdAt: number;
}

export type HeatmapSource = "gps" | "manual";

export interface TrackRow {
  id: string;
  matchId: string;
  importId: string;
  calibrationId: string | null;
  heatmapSource: HeatmapSource;
  algorithmVersion: number;
  quality: "usable" | "approximate";
  summary: TrackingSummary;
  createdAt: number;
  updatedAt: number;
}

export interface CalibrationRow {
  id: string;
  name: string;
  calibration: PitchCalibration;
  updatedAt: number;
}

export interface ActiveHeatmap {
  matchId: string;
  pitch: { length: number; width: number };
  heatmap: StoredHeatmap;
}

export interface AttachInput {
  matchId: string;
  importId: string;
  calibrationId: string | null;
  summary: TrackingSummary;
  heatmap: StoredHeatmap;
}

export interface GpsBackend {
  readonly kind: "account" | "local";
  /** Makes sure the match exists where tracking rows can reference it (synced, for accounts). */
  ensureMatchReady(matchId: string): Promise<void>;

  listImports(): Promise<ImportRow[]>;
  insertImport(row: ImportRow): Promise<void>;
  /** Removes the import row; tracks using it go with it. */
  deleteImport(id: string): Promise<void>;

  uploadFile(row: Pick<ImportRow, "id" | "format">, bytes: Uint8Array): Promise<void>;
  downloadFile(row: Pick<ImportRow, "id" | "format">): Promise<Uint8Array>;
  removeFile(row: Pick<ImportRow, "id" | "format">): Promise<void>;
  /** Every stored source file, for finding orphans after a partial failure. */
  listFiles(): Promise<Pick<ImportRow, "id" | "format">[]>;

  /** Resolves when this storage can hold GPS data; rejects with `not-set-up` when it can't (no tables or bucket). */
  checkReady(): Promise<void>;

  /** Attaches atomically, replacing any active track on the match. */
  attachTrack(input: AttachInput): Promise<{ trackId: string; replacedImportId: string | null }>;
  getActiveTrack(matchId: string): Promise<TrackRow | null>;
  getHeatmap(trackId: string): Promise<StoredHeatmap | null>;
  /** Every match's active heatmap with its pitch size, for season heatmaps. */
  listActiveHeatmaps(): Promise<ActiveHeatmap[]>;
  /** Light listing: which imports and matches tracks refer to. */
  listTrackRefs(): Promise<{ id: string; matchId: string; importId: string }[]>;
  setHeatmapSource(trackId: string, source: HeatmapSource): Promise<void>;
  deleteTrack(trackId: string): Promise<void>;

  listCalibrations(): Promise<CalibrationRow[]>;
  saveCalibration(input: { id?: string; name: string; calibration: PitchCalibration }): Promise<CalibrationRow>;
  deleteCalibration(id: string): Promise<void>;
}

export class GpsStorageError extends Error {
  constructor(
    message: string,
    readonly code: "not-signed-in" | "not-set-up" | "match-not-synced" | "not-found" | "duplicate" | "storage" | "invalid" = "storage",
  ) {
    super(message);
    this.name = "GpsStorageError";
  }
}
