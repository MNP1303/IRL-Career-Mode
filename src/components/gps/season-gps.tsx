"use client";

/** GPS heatmaps for the season view on the pitch page. Loaded only when the GPS source is chosen. */

import { useEffect, useMemo, useState } from "react";
import type { ActiveHeatmap } from "@/lib/gps/backend";
import { decodeHeatmap } from "@/lib/gps/record";
import { combineHeatmaps } from "@/lib/gps/season";
import { useGpsBackend } from "@/components/gps/use-gps-backend";

export interface SeasonGps {
  loading: boolean;
  error: string | null;
  byMatch: Map<string, ActiveHeatmap>;
}

const EMPTY = new Map<string, ActiveHeatmap>();

export function useSeasonGps(enabled: boolean): SeasonGps {
  const backend = useGpsBackend();
  const [state, setState] = useState<{ kind: string; byMatch: Map<string, ActiveHeatmap>; error: string | null } | null>(null);
  const kind = backend?.kind ?? "";

  useEffect(() => {
    if (!enabled || !backend) return;
    let live = true;
    backend
      .listActiveHeatmaps()
      .then((rows) => live && setState({ kind: backend.kind, byMatch: new Map(rows.map((row) => [row.matchId, row])), error: null }))
      .catch((error: unknown) => live && setState({ kind: backend.kind, byMatch: EMPTY, error: error instanceof Error ? error.message : "Couldn't load your GPS heatmaps." }));
    return () => {
      live = false;
    };
  }, [enabled, backend]);

  const current = state?.kind === kind ? state : null;
  return { loading: enabled && (!backend || !current), error: current?.error ?? null, byMatch: current?.byMatch ?? EMPTY };
}

/** The combined grid for the chosen matches (decoded once per selection). */
export function useSeasonGrid(rows: ActiveHeatmap[]) {
  return useMemo(
    () => combineHeatmaps(rows.map((row) => ({ pitch: row.pitch, grid: decodeHeatmap(row.heatmap), totalSeconds: row.heatmap.totalSeconds }))),
    [rows],
  );
}
