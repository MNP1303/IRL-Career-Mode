/** SHA-256 of the file's exact bytes, as lowercase hex. Uses Web Crypto (browser, worker and Node). */
export async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ImportSummaryForDuplicates {
  id: string;
  fingerprint: string;
  startedAt: number;
  endedAt: number;
  pointCount: number;
}

export type DuplicateMatch =
  | { kind: "exact"; existing: ImportSummaryForDuplicates }
  | { kind: "likely"; existing: ImportSummaryForDuplicates; reason: string };

/**
 * Finds an earlier import of the same recording. An identical fingerprint is
 * an exact duplicate. Otherwise, a different file whose start and end are
 * within two minutes and whose point count is within 5% is probably the same
 * activity exported twice (for example once as GPX, once as FIT). Both are
 * reported to the player; nothing is overwritten automatically.
 */
export function findDuplicate(
  candidate: Omit<ImportSummaryForDuplicates, "id">,
  existing: ImportSummaryForDuplicates[],
): DuplicateMatch | null {
  const exact = existing.find((item) => item.fingerprint === candidate.fingerprint);
  if (exact) return { kind: "exact", existing: exact };
  const window = 2 * 60_000;
  const likely = existing.find(
    (item) =>
      Math.abs(item.startedAt - candidate.startedAt) <= window &&
      Math.abs(item.endedAt - candidate.endedAt) <= window &&
      Math.abs(item.pointCount - candidate.pointCount) <= Math.max(10, candidate.pointCount * 0.05),
  );
  if (likely) {
    return { kind: "likely", existing: likely, reason: "It starts and ends within two minutes of an earlier import with a similar number of points." };
  }
  return null;
}
