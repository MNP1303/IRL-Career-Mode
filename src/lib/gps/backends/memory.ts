/**
 * An in-memory backend with the same semantics as the real ones (atomic
 * attach-and-replace, cascades from imports to tracks, ownership of matches),
 * plus switches to make individual operations fail. Used by tests.
 */

import { GpsStorageError, type AttachInput, type CalibrationRow, type GpsBackend, type HeatmapSource, type ImportRow, type TrackRow } from "@/lib/gps/backend";
import type { StoredHeatmap } from "@/lib/gps/record";

type Operation = keyof GpsBackend;

export class MemoryBackend implements GpsBackend {
  readonly kind: "account" | "local";
  imports = new Map<string, ImportRow>();
  files = new Map<string, Uint8Array>();
  tracks = new Map<string, TrackRow & { heatmap: StoredHeatmap; active: boolean }>();
  calibrations = new Map<string, CalibrationRow>();
  /** Matches that exist where tracks can reference them. */
  matches: Set<string>;
  failing = new Set<Operation>();
  private clock = 0;

  constructor({ matches = [], kind = "account" }: { matches?: string[]; kind?: "account" | "local" } = {}) {
    this.matches = new Set(matches);
    this.kind = kind;
  }

  private check(operation: Operation) {
    if (this.failing.has(operation)) throw new GpsStorageError(`Simulated failure: ${operation}`);
  }

  private fileKey(row: Pick<ImportRow, "id" | "format">) {
    return `${row.id}.${row.format}`;
  }

  async ensureMatchReady(matchId: string) {
    this.check("ensureMatchReady");
    if (!this.matches.has(matchId)) throw new GpsStorageError("Match not found", "match-not-synced");
  }
  async listImports() {
    return [...this.imports.values()];
  }
  async insertImport(row: ImportRow) {
    this.check("insertImport");
    if ([...this.imports.values()].some((item) => item.fingerprint === row.fingerprint)) throw new GpsStorageError("duplicate", "duplicate");
    this.imports.set(row.id, row);
  }
  async deleteImport(id: string) {
    this.check("deleteImport");
    this.imports.delete(id);
    for (const [trackId, track] of this.tracks) if (track.importId === id) this.tracks.delete(trackId);
  }
  async uploadFile(row: Pick<ImportRow, "id" | "format">, bytes: Uint8Array) {
    this.check("uploadFile");
    if (this.files.has(this.fileKey(row))) throw new GpsStorageError("exists");
    this.files.set(this.fileKey(row), bytes);
  }
  async downloadFile(row: Pick<ImportRow, "id" | "format">) {
    this.check("downloadFile");
    const bytes = this.files.get(this.fileKey(row));
    if (!bytes) throw new GpsStorageError("missing", "not-found");
    return bytes;
  }
  async removeFile(row: Pick<ImportRow, "id" | "format">) {
    this.check("removeFile");
    this.files.delete(this.fileKey(row));
  }
  async listFiles() {
    return [...this.files.keys()].map((key) => {
      const [id, format] = key.split(".");
      return { id, format: format as ImportRow["format"] };
    });
  }
  async attachTrack(input: AttachInput) {
    this.check("attachTrack");
    if (!this.matches.has(input.matchId)) throw new GpsStorageError("Match not found for this player", "not-found");
    if (!this.imports.has(input.importId)) throw new GpsStorageError("Import not found for this player", "not-found");
    const previous = [...this.tracks.values()].find((track) => track.matchId === input.matchId && track.active);
    if (previous) this.tracks.delete(previous.id);
    const id = crypto.randomUUID();
    this.clock += 1;
    this.tracks.set(id, {
      id,
      matchId: input.matchId,
      importId: input.importId,
      calibrationId: input.calibrationId,
      heatmapSource: previous?.heatmapSource ?? "gps",
      algorithmVersion: input.summary.algorithmVersion,
      quality: input.summary.quality.level as TrackRow["quality"],
      summary: input.summary,
      heatmap: input.heatmap,
      active: true,
      createdAt: this.clock,
      updatedAt: this.clock,
    });
    return { trackId: id, replacedImportId: previous && previous.importId !== input.importId ? previous.importId : null };
  }
  async getActiveTrack(matchId: string) {
    const track = [...this.tracks.values()].find((item) => item.matchId === matchId && item.active);
    if (!track) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { heatmap, active, ...row } = track;
    return row;
  }
  async getHeatmap(trackId: string) {
    return this.tracks.get(trackId)?.heatmap ?? null;
  }
  async checkReady() {
    this.check("checkReady");
  }
  async listActiveHeatmaps() {
    return [...this.tracks.values()].filter((track) => track.active).map((track) => ({ matchId: track.matchId, pitch: track.summary.pitch, heatmap: track.heatmap }));
  }
  async listTrackRefs() {
    return [...this.tracks.values()].map((track) => ({ id: track.id, matchId: track.matchId, importId: track.importId }));
  }
  async setHeatmapSource(trackId: string, source: HeatmapSource) {
    const track = this.tracks.get(trackId);
    if (track) track.heatmapSource = source;
  }
  async deleteTrack(trackId: string) {
    this.check("deleteTrack");
    this.tracks.delete(trackId);
  }
  /** What a database cascade does when a match is deleted. */
  deleteMatch(matchId: string) {
    this.matches.delete(matchId);
    if (this.kind === "account") for (const [id, track] of this.tracks) if (track.matchId === matchId) this.tracks.delete(id);
  }
  async listCalibrations() {
    return [...this.calibrations.values()];
  }
  async saveCalibration(input: { id?: string; name: string; calibration: CalibrationRow["calibration"] }) {
    const row = { id: input.id ?? crypto.randomUUID(), name: input.name, calibration: input.calibration, updatedAt: Date.now() };
    this.calibrations.set(row.id, row);
    return row;
  }
  async deleteCalibration(id: string) {
    this.calibrations.delete(id);
  }
}
