"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Repeat2, Save, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/shared/primitives";
import type { CalibrationRow, GpsBackend } from "@/lib/gps/backend";
import {
  checkCompatibility,
  CORNER_LABELS,
  createTransform,
  DIMENSION_LIMITS,
  estimateCorners,
  modelCorners,
  PITCH_PRESETS,
  reverseAttack,
  swapSides,
  type Corners,
  type PitchPreset,
} from "@/lib/gps/calibration";
import type { TrackingResult } from "@/lib/gps/pipeline";
import { checkIntervals } from "@/lib/gps/trim";
import type { LatLon } from "@/lib/gps/types";
import type { ParsedFile } from "@/lib/gps/worker-protocol";
import { RouteMap } from "@/components/gps/route-map";
import { GpsPitch, PlacementLegend } from "@/components/gps/gps-pitch";
import { compassName } from "@/components/gps/format";
import { toCalibration, type CalibrationDraft, type PlayingInterval } from "@/components/gps/wizard-state";
import { cn } from "@/lib/utils";

const PRESET_OPTIONS: { value: PitchPreset; label: string }[] = [
  { value: "5v5", label: PITCH_PRESETS["5v5"].label },
  { value: "7v7", label: PITCH_PRESETS["7v7"].label },
  { value: "11v11", label: PITCH_PRESETS["11v11"].label },
  { value: "custom", label: "Custom" },
];

function parseLatLon(text: string): LatLon | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const formatLatLon = (point: LatLon | null) => (point ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : "");

function CornerInput({ index, value, selected, onSelect, onChange }: { index: number; value: LatLon | null; selected: boolean; onSelect: () => void; onChange: (point: LatLon | null) => void }) {
  const [text, setText] = useState(formatLatLon(value));
  const [editing, setEditing] = useState(false);
  const shown = editing ? text : formatLatLon(value);
  const invalid = editing && text.trim() !== "" && !parseLatLon(text);
  return (
    <li className={cn("rounded-lg border p-2.5", selected ? "border-primary/60 bg-primary/5" : "border-border")}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-primary/60 text-primary",
          )}
        >
          {index + 1}
          <span className="sr-only">Select corner {index + 1} for placing on the map</span>
        </button>
        <span className="min-w-0 flex-1 text-xs font-semibold">{CORNER_LABELS[index]}</span>
        {value ? <CheckCircle2 className="size-4 text-primary" aria-label="Placed" /> : <span className="text-xs text-muted-foreground">Not placed</span>}
      </div>
      <Input
        className="mt-2 h-8 font-mono text-xs"
        inputMode="decimal"
        placeholder="lat, lon (e.g. 51.500120, -0.120340)"
        aria-label={`${CORNER_LABELS[index]}, latitude and longitude`}
        aria-invalid={invalid}
        value={shown}
        onFocus={() => {
          setText(formatLatLon(value));
          setEditing(true);
          onSelect();
        }}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseLatLon(event.target.value);
          if (parsed) onChange(parsed);
          else if (!event.target.value.trim()) onChange(null);
        }}
        onBlur={() => setEditing(false)}
      />
    </li>
  );
}

export function CalibrateStep({
  parsed,
  draft,
  onChange,
  intervals,
  result,
  processing,
  processError,
  backend,
}: {
  parsed: ParsedFile;
  draft: CalibrationDraft;
  onChange: (draft: CalibrationDraft) => void;
  intervals: PlayingInterval[];
  result: TrackingResult | null;
  processing: boolean;
  processError: string | null;
  backend: GpsBackend | null;
}) {
  const [selected, setSelected] = useState(0);
  const [saved, setSaved] = useState<CalibrationRow[]>([]);
  const [name, setName] = useState("");
  const calibration = useMemo(() => toCalibration(draft), [draft]);
  const transform = useMemo(() => (calibration ? createTransform(calibration) : null), [calibration]);
  const fit = transform?.fit ?? null;
  const outline = useMemo(() => (transform && fit?.ok ? (modelCorners(transform.calibration).map((point) => transform.fromPitch(point)) as Corners) : null), [transform, fit?.ok]);

  // Positions inside the playing intervals, for estimating and compatibility checks.
  const playingPoints = useMemo(() => {
    const sorted = checkIntervals(intervals, parsed.activity).intervals;
    const points = parsed.screen.points.filter((point) => !point.excluded && sorted.some((interval) => point.t >= interval.start && point.t <= interval.end));
    const stride = Math.max(1, Math.floor(points.length / 2000));
    return points.filter((_, index) => index % stride === 0);
  }, [parsed, intervals]);

  useEffect(() => {
    let live = true;
    backend
      ?.listCalibrations()
      .then((rows) => live && setSaved(rows))
      .catch(() => live && setSaved([]));
    return () => {
      live = false;
    };
  }, [backend]);

  const compatibility = useMemo(
    () => Object.fromEntries(saved.map((row) => [row.id, checkCompatibility(row.calibration, playingPoints)])),
    [saved, playingPoints],
  );

  function update(patch: Partial<CalibrationDraft>) {
    onChange({ ...draft, ...patch, savedId: patch.savedId ?? null });
  }

  function setPreset(preset: PitchPreset) {
    if (preset === "custom") update({ preset });
    else update({ preset, length: PITCH_PRESETS[preset].length, width: PITCH_PRESETS[preset].width });
  }

  function moveCorner(index: number, point: LatLon | null) {
    const corners = [...draft.corners];
    corners[index] = point;
    update({ corners, cornerSource: draft.cornerSource === "estimated" || draft.cornerSource === "saved" ? "placed" : draft.cornerSource });
  }

  function estimate() {
    const corners = estimateCorners(playingPoints, { length: draft.length, width: draft.width });
    if (!corners) {
      toast.error("Not enough positions to estimate the pitch");
      return;
    }
    update({ corners, cornerSource: "estimated" });
  }

  function transformDraft(change: typeof reverseAttack) {
    if (!calibration) return;
    const next = change(calibration);
    update({ corners: [...next.corners], cornerSource: draft.cornerSource });
  }

  async function savePitch(existing?: CalibrationRow) {
    if (!backend || !calibration || !fit?.ok) return;
    const label = (existing?.name ?? name).trim();
    if (!label) {
      toast.error("Give the pitch a name first");
      return;
    }
    try {
      const row = await backend.saveCalibration({ id: existing?.id, name: label.slice(0, 60), calibration: { ...calibration, cornerSource: calibration.cornerSource === "estimated" ? "estimated" : "saved" } });
      setSaved((rows) => [...rows.filter((item) => item.id !== row.id), row].sort((a, b) => a.name.localeCompare(b.name)));
      onChange({ ...draft, savedId: row.id });
      setName("");
      toast.success(existing ? `Updated “${row.name}”` : `Saved “${row.name}”`, { description: "Use it next time you play there." });
    } catch (error) {
      toast.error("Couldn't save the pitch", { description: error instanceof Error ? error.message : undefined });
    }
  }

  async function deletePitch(row: CalibrationRow) {
    if (!backend) return;
    try {
      await backend.deleteCalibration(row.id);
      setSaved((rows) => rows.filter((item) => item.id !== row.id));
      if (draft.savedId === row.id) onChange({ ...draft, savedId: null });
      toast(`Deleted “${row.name}”`, { description: "Matches already using it keep their own copy." });
    } catch (error) {
      toast.error("Couldn't delete the pitch", { description: error instanceof Error ? error.message : undefined });
    }
  }

  const sizeError = draft.length < DIMENSION_LIMITS.minLength || draft.length > DIMENSION_LIMITS.maxLength || draft.width < DIMENSION_LIMITS.minWidth || draft.width > DIMENSION_LIMITS.maxWidth;
  const placed = draft.corners.filter(Boolean).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Tell us where the pitch is. Pick its size, then place its four corners: select a corner and click the map, drag a corner to adjust, use
        the arrow keys (Shift for 5 m), or paste coordinates from any map app (long-press a pitch corner to copy them). The pitch is only ever
        rotated and moved into place, never stretched to fit your route.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-2">
          <RouteMap
            screen={parsed.screen}
            highlight={intervals}
            corners={draft.corners}
            selectedCorner={selected}
            onSelectCorner={setSelected}
            onMoveCorner={moveCorner}
            outline={outline}
            label={`Corner placement map. Corner ${selected + 1}, ${CORNER_LABELS[selected]}, is selected. ${placed} of 4 corners placed. Click to place the selected corner, or use the arrow keys to move it. Press 1 to 4 to select a corner.`}
          />
          <p className="text-xs text-muted-foreground">
            Bright line: your playing intervals. Dashed lime outline: the pitch as fitted, with an arrow towards the goal you attacked. No map
            imagery is loaded.
          </p>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="pitch-size">
            <h3 id="pitch-size" className="eyebrow mb-2">
              Pitch size
            </h3>
            <Segmented label="Pitch size preset" value={draft.preset} onChange={setPreset} options={PRESET_OPTIONS} size="sm" className="flex w-full" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["length", "width"] as const).map((key) => (
                <label key={key} className="text-xs text-muted-foreground">
                  <span className="mb-1 block capitalize">{key} (m)</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={key === "length" ? DIMENSION_LIMITS.minLength : DIMENSION_LIMITS.minWidth}
                    max={key === "length" ? DIMENSION_LIMITS.maxLength : DIMENSION_LIMITS.maxWidth}
                    step={0.5}
                    value={draft[key]}
                    aria-invalid={sizeError}
                    onChange={(event) => update({ preset: "custom", [key]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </div>
            {sizeError ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                Use a length of {DIMENSION_LIMITS.minLength}–{DIMENSION_LIMITS.maxLength} m and a width of {DIMENSION_LIMITS.minWidth}–{DIMENSION_LIMITS.maxWidth} m.
              </p>
            ) : null}
          </section>

          {saved.length ? (
            <section aria-labelledby="saved-pitches">
              <h3 id="saved-pitches" className="eyebrow mb-2">
                Your saved pitches
              </h3>
              <ul className="space-y-2">
                {saved.map((row) => {
                  const compat = compatibility[row.id];
                  return (
                    <li key={row.id} className={cn("rounded-lg border p-2.5", draft.savedId === row.id ? "border-primary/60" : "border-border")}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold">{row.name}</p>
                        <span className="text-xs text-muted-foreground">
                          {row.calibration.length} × {row.calibration.width} m
                        </span>
                      </div>
                      <p className={cn("mt-1 flex gap-1.5 text-xs", compat?.compatible ? "text-muted-foreground" : "text-[#f5c542]")}>
                        {compat?.compatible ? <CheckCircle2 className="mt-px size-3.5 shrink-0 text-primary" aria-hidden /> : <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />}
                        <span>
                          <span className="sr-only">{compat?.compatible ? "Compatible: " : "Check: "}</span>
                          {compat?.message}
                        </span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="xs" variant="secondary" onClick={() => onChange({ ...draftFromRow(row), savedId: row.id })}>
                          Use
                        </Button>
                        {calibration && fit?.ok && draft.savedId !== row.id ? (
                          <Button size="xs" variant="ghost" onClick={() => savePitch(row)}>
                            Replace with current corners
                          </Button>
                        ) : null}
                        <Button size="xs" variant="ghost" onClick={() => deletePitch(row)} aria-label={`Delete saved pitch ${row.name}`}>
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="corner-list">
            <h3 id="corner-list" className="eyebrow mb-2">
              Corners ({placed} of 4)
            </h3>
            <ol className="space-y-2">
              {draft.corners.map((corner, index) => (
                <CornerInput key={index} index={index} value={corner} selected={selected === index} onSelect={() => setSelected(index)} onChange={(point) => moveCorner(index, point)} />
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="xs" variant="secondary" onClick={estimate} data-icon="inline-start">
                <Sparkles /> Estimate from my movement
              </Button>
              <Button size="xs" variant="secondary" onClick={() => transformDraft(reverseAttack)} disabled={!calibration} data-icon="inline-start">
                <Repeat2 /> Reverse attack
              </Button>
              <Button size="xs" variant="secondary" onClick={() => transformDraft(swapSides)} disabled={!calibration} data-icon="inline-start">
                <ArrowLeftRight /> Swap left and right
              </Button>
              <Button size="xs" variant="ghost" onClick={() => update({ corners: [null, null, null, null], cornerSource: "placed" })} data-icon="inline-start">
                <X /> Clear
              </Button>
            </div>
            {draft.cornerSource === "estimated" ? (
              <p className="mt-2 text-xs text-[#f5c542]">
                These corners are a guess from your movement. Move them onto the real pitch corners; until then the heatmap is marked approximate.
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <section aria-labelledby="calibration-check" className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <h3 id="calibration-check" className="eyebrow mb-2">
            Preview on the pitch
          </h3>
          {result && fit?.ok ? (
            <>
              <GpsPitch pitch={result.pitch} points={result.preview} label="Your positions on the calibrated pitch, coloured by whether they fall on it" />
              <div className="mt-2">
                <PlacementLegend />
              </div>
            </>
          ) : (
            <div className="grid aspect-[105/68] place-items-center rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
              {processing ? "Placing your positions…" : placed < 4 ? "Place all four corners to preview." : processError ?? "Fix the issues listed to preview."}
            </div>
          )}
        </div>
        <div role="status" aria-live="polite" className="space-y-3 text-sm">
          {fit ? (
            <>
              {fit.issues.length ? (
                <ul className="space-y-2">
                  {fit.issues.map((issue) => (
                    <li key={issue.code} className="flex gap-2">
                      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", issue.severity === "error" ? "text-destructive" : "text-[#f5c542]")} aria-hidden />
                      <span>
                        <span className="sr-only">{issue.severity === "error" ? "Error: " : "Warning: "}</span>
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> The corners match a {draft.length} × {draft.width} m pitch.
                </p>
              )}
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Corners measure</dt>
                  <dd className="font-semibold tabular-nums">
                    {Math.round((fit.measuredSides[0] + fit.measuredSides[2]) / 2)} × {Math.round((fit.measuredSides[1] + fit.measuredSides[3]) / 2)} m
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Largest corner offset</dt>
                  <dd className="font-semibold tabular-nums">{Math.max(...fit.residuals).toFixed(1)} m</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">You attacked towards</dt>
                  <dd className="font-semibold">
                    the {compassName(fit.attackBearing)} ({Math.round(fit.attackBearing)}°). Wrong way? Use “Reverse attack”.
                  </dd>
                </div>
              </dl>
              {result && fit.ok ? (
                <p className="text-xs text-muted-foreground">
                  {result.counts.inBounds + result.counts.nearLines} of {result.counts.valid} positions are on or just outside the pitch.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Place all four corners to check the fit.</p>
          )}
          {backend && calibration && fit?.ok && !draft.savedId ? (
            <form
              className="flex gap-2 border-t border-border pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void savePitch();
              }}
            >
              <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} placeholder="Name this pitch" aria-label="Name for saving this pitch" className="h-8 text-xs" />
              <Button type="submit" size="sm" variant="secondary" data-icon="inline-start">
                <Save /> Save
              </Button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function draftFromRow(row: CalibrationRow): CalibrationDraft {
  return {
    preset: row.calibration.preset,
    length: row.calibration.length,
    width: row.calibration.width,
    corners: [...row.calibration.corners],
    cornerSource: row.calibration.cornerSource === "estimated" ? "estimated" : "saved",
    savedId: row.id,
  };
}
