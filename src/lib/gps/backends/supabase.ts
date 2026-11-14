/**
 * Account storage: Supabase tables under owner-only RLS and a private
 * storage bucket. Only the publishable key is used; the database enforces
 * ownership (see `supabase/migrations/20261112120000_gps_tracking.sql`).
 * Nothing here logs coordinates or file contents.
 */

import { GpsStorageError, type AttachInput, type CalibrationRow, type GpsBackend, type ImportRow } from "@/lib/gps/backend";
import { calibrationSchema, heatmapSchema, summarySchema } from "@/lib/gps/record";
import { currentUserId, ensureMatchSynced } from "@/lib/store";
import { getSupabase } from "@/lib/supabase";

export const GPS_BUCKET = "gps-files";
const FORMATS = new Set(["gpx", "tcx", "fit"]);

function client() {
  const supabase = getSupabase();
  const userId = currentUserId();
  if (!supabase || !userId) throw new GpsStorageError("Sign in to save GPS data to your account.", "not-signed-in");
  return { supabase, userId };
}

export const GPS_MIGRATION = "supabase/migrations/20261112120000_gps_tracking.sql";
export const NOT_SET_UP_MESSAGE = `GPS storage isn't set up on this Supabase project yet. Run ${GPS_MIGRATION} in the Supabase SQL Editor, then try again. Your match is saved either way.`;

/**
 * Missing tables, function or bucket: the GPS migration hasn't been run on
 * this project. PostgREST reports unknown tables as PGRST205 and unknown
 * functions as PGRST202; Postgres itself as 42P01 and 42883.
 */
export function isNotSetUp(error: { message?: string; code?: string; error?: string } | null) {
  if (!error) return false;
  return ["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code ?? "") || /bucket not found|NoSuchBucket|schema cache/i.test(`${error.message ?? ""} ${error.error ?? ""}`);
}

/** Database and storage errors, reworded for players. */
function fail(error: { message?: string; code?: string } | null, fallback: string): never {
  const message = error?.message ?? "";
  if (isNotSetUp(error)) throw new GpsStorageError(NOT_SET_UP_MESSAGE, "not-set-up");
  if (/not found for this player/i.test(message)) throw new GpsStorageError("That match isn't in your account.", "not-found");
  if (error?.code === "23505" || /duplicate/i.test(message)) throw new GpsStorageError("This file is already imported.", "duplicate");
  if (/fetch|network/i.test(message)) throw new GpsStorageError("Couldn't reach the server. Check your connection and try again.");
  if (/payload too large|exceeded the maximum/i.test(message)) throw new GpsStorageError("The file is larger than the 25 MB limit.");
  throw new GpsStorageError(fallback);
}

const pathFor = (userId: string, row: Pick<ImportRow, "id" | "format">) => `${userId}/${row.id}.${row.format}`;

function toImportRow(row: {
  id: string;
  fingerprint: string;
  format: string;
  file_name: string | null;
  byte_size: number;
  started_at: string;
  ended_at: string;
  point_count: number;
  metadata: unknown;
  created_at: string;
}): ImportRow {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    format: row.format as ImportRow["format"],
    fileName: row.file_name,
    byteSize: row.byte_size,
    startedAt: Date.parse(row.started_at),
    endedAt: Date.parse(row.ended_at),
    pointCount: row.point_count,
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as ImportRow["metadata"],
    createdAt: Date.parse(row.created_at),
  };
}

const IMPORT_COLUMNS = "id, fingerprint, format, file_name, byte_size, started_at, ended_at, point_count, metadata, created_at";

export const supabaseBackend: GpsBackend = {
  kind: "account",

  async ensureMatchReady(matchId) {
    try {
      await ensureMatchSynced(matchId);
    } catch (error) {
      throw new GpsStorageError(error instanceof Error ? error.message : "The match couldn't be synced.", "match-not-synced");
    }
  },

  async checkReady() {
    const { supabase, userId } = client();
    const [table, bucket] = await Promise.all([
      supabase.from("match_gps_tracks").select("id").limit(1),
      supabase.storage.from(GPS_BUCKET).list(userId, { limit: 1 }),
    ]);
    if (table.error) fail(table.error, "Couldn't reach GPS storage.");
    if (bucket.error) fail(bucket.error, "Couldn't reach GPS file storage.");
  },

  async listImports() {
    const { supabase } = client();
    const { data, error } = await supabase.from("gps_imports").select(IMPORT_COLUMNS).order("created_at");
    if (error) fail(error, "Couldn't load your GPS imports.");
    return data.map(toImportRow);
  },
  async insertImport(row) {
    const { supabase, userId } = client();
    const { error } = await supabase.from("gps_imports").insert({
      id: row.id,
      fingerprint: row.fingerprint,
      format: row.format,
      file_name: row.fileName,
      byte_size: row.byteSize,
      storage_path: pathFor(userId, row),
      started_at: new Date(row.startedAt).toISOString(),
      ended_at: new Date(row.endedAt).toISOString(),
      point_count: row.pointCount,
      metadata: row.metadata,
    });
    if (error) fail(error, "Couldn't save the import.");
  },
  async deleteImport(id) {
    const { supabase } = client();
    const { error } = await supabase.from("gps_imports").delete().eq("id", id);
    if (error) fail(error, "Couldn't delete the import.");
  },

  async uploadFile(row, bytes) {
    const { supabase, userId } = client();
    const { error } = await supabase.storage
      .from(GPS_BUCKET)
      .upload(pathFor(userId, row), new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), {
        contentType: "application/octet-stream",
        upsert: false,
      });
    if (error) fail(error, "Couldn't upload the file.");
  },
  async downloadFile(row) {
    const { supabase, userId } = client();
    const { data, error } = await supabase.storage.from(GPS_BUCKET).download(pathFor(userId, row));
    if (error || !data) fail(error, "Couldn't download the original file.");
    return new Uint8Array(await data.arrayBuffer());
  },
  async removeFile(row) {
    const { supabase, userId } = client();
    const { error } = await supabase.storage.from(GPS_BUCKET).remove([pathFor(userId, row)]);
    if (error) fail(error, "Couldn't delete the file.");
  },
  async listFiles() {
    const { supabase, userId } = client();
    const files: Pick<ImportRow, "id" | "format">[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(GPS_BUCKET).list(userId, { limit: 1000, offset });
      if (error) fail(error, "Couldn't list your GPS files.");
      for (const item of data) {
        const [id, format] = item.name.split(".");
        if (id && FORMATS.has(format)) files.push({ id, format: format as ImportRow["format"] });
      }
      if (data.length < 1000) return files;
    }
  },

  async attachTrack(input: AttachInput) {
    const { supabase } = client();
    const { data, error } = await supabase.rpc("attach_gps_track", {
      p_match_id: input.matchId,
      p_import_id: input.importId,
      p_calibration_id: input.calibrationId,
      p_algorithm_version: input.summary.algorithmVersion,
      p_quality: input.summary.quality.level,
      p_summary: input.summary,
      p_heatmap: input.heatmap,
    });
    if (error || !data?.[0]) fail(error, "Couldn't attach the GPS data to the match.");
    return { trackId: data[0].track_id, replacedImportId: data[0].replaced_import_id };
  },
  async getActiveTrack(matchId) {
    const { supabase } = client();
    // The heatmap grid isn't selected here; it's fetched only when drawn.
    const { data, error } = await supabase
      .from("match_gps_tracks")
      .select("id, match_id, import_id, calibration_id, heatmap_source, algorithm_version, quality, summary, created_at, updated_at")
      .eq("match_id", matchId)
      .eq("is_active", true)
      .limit(1);
    if (error) fail(error, "Couldn't load the match's GPS data.");
    const row = data[0];
    if (!row) return null;
    const summary = summarySchema.safeParse(row.summary);
    if (!summary.success) throw new GpsStorageError("This match's GPS data was saved by a newer version of the app.", "invalid");
    return {
      id: row.id,
      matchId: row.match_id,
      importId: row.import_id,
      calibrationId: row.calibration_id,
      heatmapSource: row.heatmap_source === "manual" ? "manual" : "gps",
      algorithmVersion: row.algorithm_version,
      quality: row.quality === "approximate" ? "approximate" : "usable",
      summary: summary.data,
      createdAt: Date.parse(row.created_at),
      updatedAt: Date.parse(row.updated_at),
    };
  },
  async getHeatmap(trackId) {
    const { supabase } = client();
    const { data, error } = await supabase.from("match_gps_tracks").select("heatmap").eq("id", trackId).limit(1);
    if (error) fail(error, "Couldn't load the heatmap.");
    const parsed = heatmapSchema.safeParse(data[0]?.heatmap);
    return parsed.success ? parsed.data : null;
  },
  async listActiveHeatmaps() {
    const { supabase } = client();
    const { data, error } = await supabase.from("match_gps_tracks").select("match_id, heatmap, summary").eq("is_active", true);
    if (error) fail(error, "Couldn't load your GPS heatmaps.");
    return data.flatMap((row) => {
      const heatmap = heatmapSchema.safeParse(row.heatmap);
      const summary = summarySchema.safeParse(row.summary);
      return heatmap.success && summary.success ? [{ matchId: row.match_id, pitch: summary.data.pitch, heatmap: heatmap.data }] : [];
    });
  },
  async listTrackRefs() {
    const { supabase } = client();
    const { data, error } = await supabase.from("match_gps_tracks").select("id, match_id, import_id");
    if (error) fail(error, "Couldn't load your GPS tracks.");
    return data.map((row) => ({ id: row.id, matchId: row.match_id, importId: row.import_id }));
  },
  async setHeatmapSource(trackId, source) {
    const { supabase } = client();
    const { error } = await supabase.from("match_gps_tracks").update({ heatmap_source: source }).eq("id", trackId);
    if (error) fail(error, "Couldn't change the heatmap source.");
  },
  async deleteTrack(trackId) {
    const { supabase } = client();
    const { error } = await supabase.from("match_gps_tracks").delete().eq("id", trackId);
    if (error) fail(error, "Couldn't delete the GPS data.");
  },

  async listCalibrations() {
    const { supabase } = client();
    const { data, error } = await supabase.from("gps_calibrations").select("id, name, data, updated_at").order("name");
    if (error) fail(error, "Couldn't load your saved pitches.");
    return data.flatMap((row): CalibrationRow[] => {
      const parsed = calibrationSchema.safeParse(row.data);
      return parsed.success ? [{ id: row.id, name: row.name, calibration: parsed.data, updatedAt: Date.parse(row.updated_at) }] : [];
    });
  },
  async saveCalibration(input) {
    const { supabase } = client();
    const data = calibrationSchema.parse(input.calibration);
    const query = input.id
      ? supabase.from("gps_calibrations").update({ name: input.name, data }).eq("id", input.id)
      : supabase.from("gps_calibrations").insert({ name: input.name, data });
    const { data: rows, error } = await query.select("id, name, updated_at");
    if (error || !rows?.[0]) {
      if (error?.code === "23505") throw new GpsStorageError(`You already have a pitch called “${input.name}”.`, "duplicate");
      fail(error, "Couldn't save the pitch.");
    }
    return { id: rows[0].id, name: rows[0].name, calibration: data, updatedAt: Date.parse(rows[0].updated_at) };
  },
  async deleteCalibration(id) {
    const { supabase } = client();
    const { error } = await supabase.from("gps_calibrations").delete().eq("id", id);
    if (error) fail(error, "Couldn't delete the pitch.");
  },
};
