/**
 * Providers turn some source (today: a file the player picks) into the same
 * `NormalisedActivity`. Everything after this point (screening, trimming,
 * calibration, heatmap, metrics, storage) is provider-agnostic.
 *
 * Future providers (Strava, Apple Health, Garmin Connect, Outplay) would
 * implement `ActivitySource` and return activities with their own
 * `provenance.provider`; nothing else in the pipeline needs to change.
 */

import { DEFAULT_LIMITS, type ImportLimits } from "@/lib/gps/errors";
import { sha256Hex } from "@/lib/gps/fingerprint";
import { parseActivity } from "@/lib/gps/parse";
import type { NormalisedActivity, SourceFormat } from "@/lib/gps/types";

export interface ImportedActivity {
  activity: NormalisedActivity;
  /** SHA-256 of the exact source bytes, for duplicate detection. */
  fingerprint: string;
  format: SourceFormat;
}

export interface ActivitySource<Input> {
  readonly id: string;
  load(input: Input, limits?: ImportLimits): Promise<ImportedActivity>;
}

/** GPX, TCX or FIT bytes, detected by content. */
export const fileSource: ActivitySource<Uint8Array> = {
  id: "file",
  async load(bytes, limits = DEFAULT_LIMITS) {
    const activity = parseActivity(bytes, limits);
    return { activity, fingerprint: await sha256Hex(bytes), format: activity.provenance.format };
  },
};
