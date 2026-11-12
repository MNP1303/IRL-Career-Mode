/**
 * The rules for keeping GPS imports, independent of where they're stored:
 * duplicates are reported (never silently overwritten), attaching replaces
 * atomically, partial failures are cleaned up, and deleting removes the
 * tracking data and source file but never the match.
 */

import { GpsStorageError, type CalibrationRow, type GpsBackend, type ImportRow, type TrackRow } from "@/lib/gps/backend";
import { findDuplicate, type DuplicateMatch } from "@/lib/gps/fingerprint";
import type { TrackingResult } from "@/lib/gps/pipeline";
import { toStored } from "@/lib/gps/record";
import type { NormalisedActivity, SourceFormat } from "@/lib/gps/types";

/** Unattached imports younger than this are left alone by cleanup (an import may be mid-save). */
export const ORPHAN_GRACE_MS = 60 * 60_000;

export interface DuplicateReport {
  match: DuplicateMatch;
  /** Matches the earlier import is attached to. */
  attachedTo: string[];
}

export interface PendingImport {
  fingerprint: string;
  format: SourceFormat;
  fileName: string | null;
  bytes: Uint8Array;
  activity: Pick<NormalisedActivity, "startTime" | "endTime" | "pointCount" | "provenance">;
}

export async function checkDuplicate(backend: GpsBackend, pending: Pick<PendingImport, "fingerprint" | "activity">): Promise<DuplicateReport | null> {
  const imports = await backend.listImports();
  const match = findDuplicate(
    {
      fingerprint: pending.fingerprint,
      startedAt: pending.activity.startTime,
      endedAt: pending.activity.endTime,
      pointCount: pending.activity.pointCount,
    },
    imports.map((row) => ({ id: row.id, fingerprint: row.fingerprint, startedAt: row.startedAt, endedAt: row.endedAt, pointCount: row.pointCount })),
  );
  if (!match) return null;
  const refs = await backend.listTrackRefs();
  return { match, attachedTo: refs.filter((ref) => ref.importId === match.existing.id).map((ref) => ref.matchId) };
}

function newId() {
  return crypto.randomUUID();
}

async function bestEffort(task: () => Promise<unknown>) {
  try {
    await task();
  } catch {
    // Cleanup that fails is retried by `cleanupOrphans`; it must never mask the original error.
  }
}

/** Removes an import's row (and with it any tracks) and then its file. */
async function removeImport(backend: GpsBackend, row: Pick<ImportRow, "id" | "format">) {
  await backend.deleteImport(row.id);
  await bestEffort(() => backend.removeFile(row));
}

export async function saveTracking(
  backend: GpsBackend,
  {
    matchId,
    pending,
    result,
    calibrationId = null,
  }: {
    matchId: string;
    pending: PendingImport;
    result: TrackingResult;
    calibrationId?: string | null;
  },
): Promise<{ trackId: string; importId: string }> {
  if (result.quality.level === "insufficient") {
    throw new GpsStorageError("This recording isn't good enough for a heatmap, so it can't be attached.", "invalid");
  }
  const stored = toStored(result);
  await backend.ensureMatchReady(matchId);

  // Re-use the earlier upload of the exact same file (recalibrating, or replacing with the same file).
  const imports = await backend.listImports();
  const existing = imports.find((row) => row.fingerprint === pending.fingerprint);
  let created: ImportRow | null = null;
  let importId: string;
  if (existing) {
    importId = existing.id;
  } else {
    created = {
      id: newId(),
      fingerprint: pending.fingerprint,
      format: pending.format,
      fileName: pending.fileName,
      byteSize: pending.bytes.byteLength,
      startedAt: pending.activity.startTime,
      endedAt: pending.activity.endTime,
      pointCount: pending.activity.pointCount,
      metadata: {
        ...(pending.activity.provenance.creator ? { creator: pending.activity.provenance.creator } : {}),
        ...(pending.activity.provenance.sport ? { sport: pending.activity.provenance.sport } : {}),
        parserVersion: pending.activity.provenance.parserVersion,
      },
      createdAt: Date.now(),
    };
    importId = created.id;
    await backend.uploadFile(created, pending.bytes);
    try {
      await backend.insertImport(created);
    } catch (error) {
      await bestEffort(() => backend.removeFile(created!));
      throw error;
    }
  }

  let attached: { trackId: string; replacedImportId: string | null };
  try {
    attached = await backend.attachTrack({ matchId, importId, calibrationId, summary: stored.summary, heatmap: stored.heatmap });
  } catch (error) {
    if (created) {
      const row = created;
      await bestEffort(() => removeImport(backend, row));
    }
    throw error;
  }

  // The replaced import's file goes too, unless another match still uses it.
  if (attached.replacedImportId) {
    const replaced = imports.find((row) => row.id === attached.replacedImportId);
    const refs = await backend.listTrackRefs();
    if (replaced && !refs.some((ref) => ref.importId === replaced.id)) await bestEffort(() => removeImport(backend, replaced));
  }
  return { trackId: attached.trackId, importId };
}

/**
 * Deletes a match's GPS tracking: the track, and the import and source file
 * when nothing else uses them. The match and its manual data are untouched.
 */
export async function removeTracking(backend: GpsBackend, matchId: string) {
  const track = await backend.getActiveTrack(matchId);
  if (!track) return false;
  await backend.deleteTrack(track.id);
  const refs = await backend.listTrackRefs();
  if (!refs.some((ref) => ref.importId === track.importId)) {
    const row = (await backend.listImports()).find((item) => item.id === track.importId);
    if (row) await removeImport(backend, row);
  }
  return true;
}

/**
 * Removes leftovers from interrupted saves or deleted matches: tracks for
 * matches that no longer exist (local storage only; the database cascades),
 * imports nothing refers to (after a grace period), and files with no import.
 */
export async function cleanupOrphans(backend: GpsBackend, { knownMatchIds, now = Date.now() }: { knownMatchIds?: Set<string>; now?: number } = {}) {
  let removed = 0;
  let refs = await backend.listTrackRefs();
  if (knownMatchIds && backend.kind === "local") {
    for (const ref of refs.filter((item) => !knownMatchIds.has(item.matchId))) {
      await backend.deleteTrack(ref.id);
      removed += 1;
    }
    refs = await backend.listTrackRefs();
  }
  const used = new Set(refs.map((ref) => ref.importId));
  const imports = await backend.listImports();
  for (const row of imports) {
    if (!used.has(row.id) && now - row.createdAt > ORPHAN_GRACE_MS) {
      await bestEffort(() => removeImport(backend, row));
      removed += 1;
    }
  }
  const remaining = new Set((await backend.listImports()).map((row) => row.id));
  for (const file of await backend.listFiles()) {
    if (!remaining.has(file.id)) {
      await bestEffort(() => backend.removeFile(file));
      removed += 1;
    }
  }
  return removed;
}

/** Deletes every GPS import, file and saved calibration the player has. */
export async function deleteAllGpsData(backend: GpsBackend) {
  for (const row of await backend.listImports()) await removeImport(backend, row);
  for (const file of await backend.listFiles()) await bestEffort(() => backend.removeFile(file));
  for (const calibration of await backend.listCalibrations()) await backend.deleteCalibration(calibration.id);
}

export async function loadSourceFile(backend: GpsBackend, track: Pick<TrackRow, "importId">) {
  const row = (await backend.listImports()).find((item) => item.id === track.importId);
  if (!row) throw new GpsStorageError("The original file for this import is missing.", "not-found");
  return { row, bytes: await backend.downloadFile(row) };
}

export type { CalibrationRow };
