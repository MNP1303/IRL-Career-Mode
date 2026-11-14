/**
 * Guest storage: GPS imports kept in this browser's IndexedDB. Nothing leaves
 * the device. Clearing site data removes it, like the guest career itself.
 */

import { GpsStorageError, type AttachInput, type CalibrationRow, type GpsBackend, type HeatmapSource, type ImportRow, type TrackRow } from "@/lib/gps/backend";
import { heatmapSchema, summarySchema, type StoredHeatmap } from "@/lib/gps/record";

const DB_NAME = "irl-career-mode-gps";
const VERSION = 1;
const STORES = ["imports", "files", "tracks", "calibrations"] as const;
type Store = (typeof STORES)[number];

type StoredTrack = TrackRow & { heatmap: StoredHeatmap; active: boolean };

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new GpsStorageError("This browser can't store GPS data."));
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(new GpsStorageError("Couldn't open this browser's storage for GPS data."));
    };
  });
  return opening;
}

function wrap<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new GpsStorageError(request.error?.message ?? "Browser storage failed"));
  });
}

async function run<T>(stores: Store[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new GpsStorageError(tx.error?.message ?? "Browser storage failed"));
  });
  const result = await work(tx);
  await done;
  return result;
}

const all = <T>(tx: IDBTransaction, store: Store) => wrap(tx.objectStore(store).getAll()) as Promise<T[]>;
const fileKey = (row: Pick<ImportRow, "id" | "format">) => `${row.id}.${row.format}`;

export const localBackend: GpsBackend = {
  kind: "local",
  async ensureMatchReady() {},
  async checkReady() {},

  listImports: () => run(["imports"], "readonly", (tx) => all<ImportRow>(tx, "imports")),
  insertImport: (row) =>
    run(["imports"], "readwrite", async (tx) => {
      const existing = await all<ImportRow>(tx, "imports");
      if (existing.some((item) => item.fingerprint === row.fingerprint)) throw new GpsStorageError("This file is already imported.", "duplicate");
      await wrap(tx.objectStore("imports").put(row, row.id));
    }),
  deleteImport: (id) =>
    run(["imports", "tracks"], "readwrite", async (tx) => {
      await wrap(tx.objectStore("imports").delete(id));
      for (const track of await all<StoredTrack>(tx, "tracks")) if (track.importId === id) await wrap(tx.objectStore("tracks").delete(track.id));
    }),

  uploadFile: (row, bytes) =>
    run(["files"], "readwrite", async (tx) => {
      await wrap(tx.objectStore("files").put(new Blob([new Uint8Array(bytes)]), fileKey(row)));
    }),
  async downloadFile(row) {
    const blob = await run(["files"], "readonly", (tx) => wrap(tx.objectStore("files").get(fileKey(row))) as Promise<Blob | undefined>);
    if (!blob) throw new GpsStorageError("The original file is missing from this browser.", "not-found");
    return new Uint8Array(await blob.arrayBuffer());
  },
  removeFile: (row) => run(["files"], "readwrite", async (tx) => void (await wrap(tx.objectStore("files").delete(fileKey(row))))),
  listFiles: () =>
    run(["files"], "readonly", async (tx) => {
      const keys = (await wrap(tx.objectStore("files").getAllKeys())) as string[];
      return keys.map((key) => {
        const [id, format] = key.split(".");
        return { id, format: format as ImportRow["format"] };
      });
    }),

  attachTrack: (input: AttachInput) =>
    run(["imports", "tracks"], "readwrite", async (tx) => {
      const importRow = await wrap(tx.objectStore("imports").get(input.importId));
      if (!importRow) throw new GpsStorageError("Import not found.", "not-found");
      const tracks = await all<StoredTrack>(tx, "tracks");
      const previous = tracks.find((track) => track.matchId === input.matchId && track.active);
      if (previous) await wrap(tx.objectStore("tracks").delete(previous.id));
      const now = Date.now();
      const row: StoredTrack = {
        id: crypto.randomUUID(),
        matchId: input.matchId,
        importId: input.importId,
        calibrationId: input.calibrationId,
        heatmapSource: previous?.heatmapSource ?? "gps",
        algorithmVersion: input.summary.algorithmVersion,
        quality: input.summary.quality.level as TrackRow["quality"],
        summary: input.summary,
        heatmap: input.heatmap,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      await wrap(tx.objectStore("tracks").put(row, row.id));
      return { trackId: row.id, replacedImportId: previous && previous.importId !== input.importId ? previous.importId : null };
    }),
  async getActiveTrack(matchId) {
    const tracks = await run(["tracks"], "readonly", (tx) => all<StoredTrack>(tx, "tracks"));
    const track = tracks.find((item) => item.matchId === matchId && item.active);
    if (!track) return null;
    const summary = summarySchema.safeParse(track.summary);
    if (!summary.success) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { heatmap, active, ...row } = track;
    return { ...row, summary: summary.data };
  },
  async getHeatmap(trackId) {
    const track = await run(["tracks"], "readonly", (tx) => wrap(tx.objectStore("tracks").get(trackId)) as Promise<StoredTrack | undefined>);
    const parsed = heatmapSchema.safeParse(track?.heatmap);
    return parsed.success ? parsed.data : null;
  },
  async listActiveHeatmaps() {
    const tracks = await run(["tracks"], "readonly", (tx) => all<StoredTrack>(tx, "tracks"));
    return tracks.flatMap((track) => {
      const heatmap = heatmapSchema.safeParse(track.heatmap);
      const summary = summarySchema.safeParse(track.summary);
      return track.active && heatmap.success && summary.success ? [{ matchId: track.matchId, pitch: summary.data.pitch, heatmap: heatmap.data }] : [];
    });
  },
  async listTrackRefs() {
    const tracks = await run(["tracks"], "readonly", (tx) => all<StoredTrack>(tx, "tracks"));
    return tracks.map((track) => ({ id: track.id, matchId: track.matchId, importId: track.importId }));
  },
  setHeatmapSource: (trackId, source: HeatmapSource) =>
    run(["tracks"], "readwrite", async (tx) => {
      const track = (await wrap(tx.objectStore("tracks").get(trackId))) as StoredTrack | undefined;
      if (track) await wrap(tx.objectStore("tracks").put({ ...track, heatmapSource: source, updatedAt: Date.now() }, trackId));
    }),
  deleteTrack: (trackId) => run(["tracks"], "readwrite", async (tx) => void (await wrap(tx.objectStore("tracks").delete(trackId)))),

  listCalibrations: () => run(["calibrations"], "readonly", (tx) => all<CalibrationRow>(tx, "calibrations")),
  saveCalibration: (input) =>
    run(["calibrations"], "readwrite", async (tx) => {
      const existing = await all<CalibrationRow>(tx, "calibrations");
      if (existing.some((row) => row.name === input.name && row.id !== input.id)) {
        throw new GpsStorageError(`You already have a pitch called “${input.name}”.`, "duplicate");
      }
      const row: CalibrationRow = { id: input.id ?? crypto.randomUUID(), name: input.name, calibration: input.calibration, updatedAt: Date.now() };
      await wrap(tx.objectStore("calibrations").put(row, row.id));
      return row;
    }),
  deleteCalibration: (id) => run(["calibrations"], "readwrite", async (tx) => void (await wrap(tx.objectStore("calibrations").delete(id)))),
};
