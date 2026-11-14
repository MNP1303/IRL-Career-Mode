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
  modelCorners,
  PITCH_PRESETS,
  reverseAttack,
  swapSides,
  type Corners,
  type PitchPreset,
} from "@/lib/gps/calibration";
import type { TrackingResult } from "@/lib/gps/pipeline";
import type { LatLon } from "@/lib/gps/types";
import type { ParsedFile } from "@/lib/gps/worker-protocol";
import { RouteMap } from "@/components/gps/route-map";
import { GpsPitch, PlacementLegend } from "@/components/gps/gps-pitch";
import { compassName } from "@/components/gps/format";
import type { Position } from "@/lib/domain";
import { detectDraft, playingPoints as selectPlayingPoints, toCalibration, type CalibrationDraft, type PitchDetection, type PlayingInterval } from "@/components/gps/wizard-state";
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
  position,
  detection,
  onDetection,
}: {
  parsed: ParsedFile;
  draft: CalibrationDraft;
  onChange: (draft: CalibrationDraft) => void;
  intervals: PlayingInterval[];
  result: TrackingResult | null;
  processing: boolean;
  processError: string | null;
  backend: GpsBackend | null;
  position: Position | null;
  detection: PitchDetection | null;
  onDetection: (detection: PitchDetection | null) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [saved, setSaved] = useState<CalibrationRow[]>([]);
  const [name, setName] = useState("");
  const calibration = useMemo(() => toCalibration(draft), [draft]);
  const transform = useMemo(() => (calibration ? createTransform(calibration) : null), [calibration]);
  const fit = transform?.fit ?? null;
  const outline = useMemo(() => (transform && fit?.ok ? (modelCorners(transform.calibration).map((point) => transform.fromPitch(point)) as Corners) : null), [transform, fit?.ok]);

  // Positions inside the playing intervals, for compatibility checks.
  const playingPoints = useMemo(() => selectPlayingPoints(parsed, intervals, 2000), [parsed, intervals]);

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

  /** Applies a change; a detected pitch is detected again at the new size, since it's only a guess anyway. */
  function resize(patch: Pick<CalibrationDraft, "preset"> & Partial<Pick<CalibrationDraft, "length" | "width">>) {
    const next = { ...draft, ...patch };
    const valid = next.length >= DIMENSION_LIMITS.minLength && next.length <= DIMENSION_LIMITS.maxLength && next.width >= DIMENSION_LIMITS.minWidth && next.width <= DIMENSION_LIMITS.maxWidth;
    if (draft.cornerSource === "estimated" && valid) {
      const detected = detectDraft(parsed, intervals, next, position);
      if (detected) {
        onDetection(detected.detection);
        onChange(detected.draft);
        return;
      }
    }
    update(patch);
  }

  function setPreset(preset: PitchPreset) {
    if (preset === "custom") resize({ preset });
    else resize({ preset, length: PITCH_PRESETS[preset].length, width: PITCH_PRESETS[preset].width });
  }

  function moveCorner(index: number, point: LatLon | null) {
    const corners = [...draft.corners];
    corners[index] = point;
    update({ corners, cornerSource: draft.cornerSource === "estimated" || draft.cornerSource === "saved" ? "placed" : draft.cornerSource });
  }

  function estimate() {
    const detected = detectDraft(parsed, intervals, draft, position);
    if (!detected) {
      toast.error("Not enough positions to find the pitch", { description: "Check your playing intervals, or place the corners yourself." });
      return;
    }
    onDetection(detected.detection);
    onChange(detected.draft);
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
                    onChange={(event) => resize({ preset: "custom", [key]: Number(event.target.value) })}
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

          {detection && draft.cornerSource === "estimated" ? (
            <DetectionPanel detection={detection} draft={draft} onPickCorners={(corners) => update({ corners: [...corners], cornerSource: "estimated" })} onPreset={setPreset} />
          ) : null}

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
                <Sparkles /> Detect from my movement
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
            {draft.cornerSource === "estimated" && !detection ? (
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

const CONFIDENCE_LABEL = { high: "High confidence", medium: "Check it", low: "Low confidence" } as const;

const sameCorners = (a: (LatLon | null)[], b: Corners) => a.every((corner, index) => corner && corner.lat === b[index].lat && corner.lon === b[index].lon);

/** What detection found, how sure it is, and the one thing the player may need to tell it: the direction they attacked. */
function DetectionPanel({
  detection,
  draft,
  onPickCorners,
  onPreset,
}: {
  detection: PitchDetection;
  draft: CalibrationDraft;
  onPickCorners: (corners: Corners) => void;
  onPreset: (preset: PitchPreset) => void;
}) {
  const directions = useMemo(() => {
    const options = [detection.corners, ...(detection.alternative ? [detection.alternative] : [])];
    return options.map((corners) => ({
      corners,
      bearing: createTransform({ version: 1, corners, length: draft.length, width: draft.width, preset: draft.preset, cornerSource: "estimated" }).fit.attackBearing,
    }));
  }, [detection, draft.length, draft.width, draft.preset]);
  const moved = !directions.some((option) => sameCorners(draft.corners, option.corners));
  const suggested = detection.suggestedPreset ? PITCH_PRESETS[detection.suggestedPreset] : null;
  return (
    <section aria-labelledby="pitch-detection" className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="pitch-detection" className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> Pitch found from your movement
        </h3>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] font-semibold",
            detection.confidence === "high" ? "bg-primary/15 text-primary" : detection.confidence === "medium" ? "bg-[#f5c542]/15 text-[#f5c542]" : "bg-destructive/15 text-destructive",
          )}
        >
          {CONFIDENCE_LABEL[detection.confidence]}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {Math.round(detection.insideShare * 100)}% of your playing time falls on this pitch. You covered about {Math.round(detection.footprint.length)} ×{" "}
        {Math.round(detection.footprint.width)} m of it.
      </p>
      {detection.alternative && !moved ? (
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold">Which way did you attack in the first half?</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {directions.map((option) => {
              const active = sameCorners(draft.corners, option.corners);
              return (
                <Button key={option.bearing} size="xs" variant={active ? "default" : "secondary"} aria-pressed={active} onClick={() => onPickCorners(option.corners)}>
                  Towards the {compassName(option.bearing)}
                </Button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {suggested && detection.suggestedPreset ? (
        <Button size="xs" variant="secondary" className="mt-3" onClick={() => onPreset(detection.suggestedPreset!)}>
          Use {suggested.label} ({suggested.length} × {suggested.width} m)
        </Button>
      ) : null}
      {detection.notes.length ? (
        <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {detection.notes.map((note) => (
            <li key={note} className="flex gap-1.5">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-[#f5c542]" aria-hidden />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        It&apos;s an estimate, so the heatmap is marked approximate. Drag any corner onto the real pitch to make it exact.
      </p>
    </section>
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
