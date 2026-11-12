"use client";

/**
 * The GPS import wizard: file → preview → trim → pitch → heatmap → attach.
 * Everything runs in the browser (parsing and processing in a worker) and
 * nothing is stored until the player confirms in the last step.
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, MapPinned } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GpsProcessor, GpsTaskError } from "@/lib/gps/client";
import { createTransform } from "@/lib/gps/calibration";
import { DEFAULT_LIMITS } from "@/lib/gps/errors";
import type { TrackingResult } from "@/lib/gps/pipeline";
import type { TrackingSummary } from "@/lib/gps/record";
import { checkDuplicate, saveTracking, type DuplicateReport } from "@/lib/gps/service";
import { checkIntervals, defaultIntervals, type PlayingInterval } from "@/lib/gps/trim";
import type { WorkerFailure } from "@/lib/gps/worker-protocol";
import { useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useGpsBackend } from "@/components/gps/use-gps-backend";
import { FileStep } from "@/components/gps/steps/file-step";
import { DuplicateNotice, duplicateNeedsConsent, PreviewStep } from "@/components/gps/steps/preview-step";
import { TrimStep } from "@/components/gps/steps/trim-step";
import { CalibrateStep } from "@/components/gps/steps/calibrate-step";
import { HeatmapStep } from "@/components/gps/steps/heatmap-step";
import { AttachStep } from "@/components/gps/steps/attach-step";
import {
  draftFromCalibration,
  draftFromPreset,
  STEPS,
  toCalibration,
  type CalibrationDraft,
  type LoadedFile,
  type PendingGpsAttachment,
  type StepId,
  type WizardTarget,
} from "@/components/gps/wizard-state";

export interface WizardInitial {
  bytes: Uint8Array;
  fileName: string | null;
  summary?: TrackingSummary;
  calibrationId?: string | null;
}

function StepList({ current, reachable, onGo }: { current: StepId; reachable: (step: StepId) => boolean; onGo: (step: StepId) => void }) {
  const index = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Import steps">
      {STEPS.map((step, position) => {
        const done = position < index;
        const active = position === index;
        const canGo = !active && reachable(step.id);
        return (
          <li key={step.id}>
            <button
              type="button"
              disabled={!canGo}
              onClick={() => onGo(step.id)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 text-primary",
                !active && !done && "border-border text-muted-foreground",
                canGo && "hover:border-primary/70",
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : <span aria-hidden>{position + 1}</span>}
              {step.label}
              {done ? <span className="sr-only">(done)</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function GpsImportWizard({
  open,
  onOpenChange,
  target,
  initial,
  onAttached,
  onPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: WizardTarget;
  initial?: WizardInitial;
  onAttached?: () => void;
  onPending?: (pending: PendingGpsAttachment) => void;
}) {
  const backend = useGpsBackend();
  const { matches } = useCareer();
  const processor = useRef<GpsProcessor | null>(null);
  const [step, setStep] = useState<StepId>("file");
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<WorkerFailure | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateReport | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [intervals, setIntervals] = useState<PlayingInterval[]>([]);
  const [draft, setDraft] = useState<CalibrationDraft>(() => draftFromPreset(target.kind === "existing" ? target.match.format : target.format));
  const [outcome, setOutcome] = useState<{ key: string; result: TrackingResult | null; error: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const currentMatchId = target.kind === "existing" ? target.match.id : undefined;
  const manualHref = target.kind === "existing" ? `/matches/${target.match.id}/edit` : undefined;

  useEffect(() => {
    if (!open) return;
    processor.current ??= new GpsProcessor();
    return () => {
      processor.current?.dispose();
      processor.current = null;
    };
  }, [open]);

  // Each load gets a number; a slower, older load (or one cancelled by a remount) is ignored.
  const loadToken = useRef(0);
  async function loadBytes(bytes: Uint8Array, name: string | null, summary?: TrackingSummary) {
    const token = ++loadToken.current;
    setReading(true);
    setFileError(null);
    setOutcome(null);
    try {
      processor.current ??= new GpsProcessor();
      const parsed = await processor.current.parse(bytes);
      if (token !== loadToken.current) return;
      setLoaded({ bytes, name, parsed });
      setAcknowledged(false);
      if (summary) {
        // Re-opening an attached import: start from its saved trim and pitch.
        setIntervals(summary.intervals);
        setDraft(draftFromCalibration(summary.calibration, initial?.calibrationId ?? null));
        setDuplicate(null);
        setStep("trim");
      } else {
        setIntervals(defaultIntervals(parsed.activity));
        setDuplicate(backend ? await checkDuplicate(backend, { fingerprint: parsed.fingerprint, activity: parsed.activity }).catch(() => null) : null);
        setStep("preview");
      }
    } catch (error) {
      if (token !== loadToken.current) return;
      setLoaded(null);
      setFileError(error instanceof GpsTaskError ? error.failure : { kind: "unexpected", title: "Couldn't read the file", message: "Try exporting it again." });
    } finally {
      if (token === loadToken.current) setReading(false);
    }
  }

  // Re-opening an attached import loads its stored file straight away.
  const loadInitial = useEffectEvent(() => {
    if (initial) void loadBytes(initial.bytes, initial.fileName, initial.summary);
  });
  useEffect(() => {
    if (!open) return;
    // Started after mount, so a strict-mode double mount only ever runs one load.
    const timer = setTimeout(loadInitial, 0);
    return () => {
      clearTimeout(timer);
      // Closing or remounting supersedes a load still in flight.
      loadToken.current += 1;
    };
  }, [open]);

  async function onFile(file: File) {
    if (file.size > DEFAULT_LIMITS.maxBytes) {
      setFileError({ kind: "import", code: "limit_exceeded", title: "This file is too large to process", message: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${Math.round(DEFAULT_LIMITS.maxBytes / 1024 / 1024)} MB.` });
      return;
    }
    if (file.size === 0) {
      setFileError({ kind: "import", code: "empty_file", title: "This file is empty", message: "The file has no content." });
      return;
    }
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name.slice(0, 200));
  }

  const calibration = useMemo(() => toCalibration(draft), [draft]);
  const intervalCheck = useMemo(() => (loaded ? checkIntervals(intervals, loaded.parsed.activity) : null), [intervals, loaded]);
  const calibrationOk = useMemo(() => (calibration ? createTransform(calibration).fit.ok : false), [calibration]);

  // Re-process (in the worker) whenever the trim or pitch changes. Results are keyed by
  // their inputs, so a stale one is never shown for newer settings.
  const ready = Boolean(loaded && calibration && calibrationOk && intervalCheck?.ok);
  const inputKey = ready ? JSON.stringify([loaded!.parsed.session, intervalCheck!.intervals, calibration]) : "";
  useEffect(() => {
    if (!inputKey || !loaded || !calibration || !intervalCheck) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const next = await processor.current!.process(loaded.parsed.session, intervalCheck.intervals, calibration);
        if (live) setOutcome({ key: inputKey, result: next, error: null });
      } catch (error) {
        if (live) setOutcome({ key: inputKey, result: null, error: error instanceof Error ? error.message : "Processing failed" });
      }
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [inputKey, loaded, calibration, intervalCheck]);
  const current = ready && outcome?.key === inputKey ? outcome : null;
  const result = current?.result ?? null;
  const processError = current?.error ?? null;
  const processing = ready && !current;

  // Move focus to the step heading on every step change, for keyboard and screen-reader users.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const blockers: Record<StepId, string | null> = {
    file: loaded ? null : "Choose a file first.",
    preview: duplicateNeedsConsent(duplicate, currentMatchId) && !acknowledged ? "Confirm you want to continue with this file." : null,
    trim: intervalCheck?.ok ? null : (intervalCheck?.errors[0] ?? "Mark at least one playing interval."),
    calibrate: !calibration ? "Place all four corners." : !calibrationOk ? "Fix the pitch issues listed." : null,
    heatmap: !result ? "The heatmap isn't ready yet." : result.quality.level === "insufficient" ? "This recording can't make a heatmap." : null,
    attach: null,
  };
  const position = STEPS.findIndex((item) => item.id === step);
  const reachable = (id: StepId) => {
    const targetIndex = STEPS.findIndex((item) => item.id === id);
    return STEPS.slice(0, targetIndex).every((item) => !blockers[item.id]);
  };

  async function attach() {
    if (!loaded || !result) return;
    const pending = {
      fingerprint: loaded.parsed.fingerprint,
      format: loaded.parsed.format,
      fileName: loaded.name,
      bytes: loaded.bytes,
      activity: loaded.parsed.activity,
    };
    if (target.kind === "new") {
      onPending?.({ pending, result, calibrationId: draft.savedId });
      onOpenChange(false);
      toast.success("GPS file ready", { description: "It will be attached when you save the match." });
      return;
    }
    if (!backend) return;
    setSaving(true);
    try {
      await saveTracking(backend, { matchId: target.match.id, pending, result, calibrationId: draft.savedId });
      toast.success("GPS data attached", { description: "Your match stats and progression are unchanged." });
      onAttached?.();
      onOpenChange(false);
    } catch (error) {
      toast.error("Couldn't attach the GPS data", { description: error instanceof Error ? error.message : "Nothing was changed. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const next = STEPS[position + 1];
  const nextLabel = step === "attach" ? (target.kind === "new" ? "Use with this match" : target.hasTrack ? "Replace GPS data" : "Attach GPS to match") : next ? `Next: ${next.label}` : "";

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent
        className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        // React events bubble through portals: keep the wizard's own forms from submitting a
        // surrounding form (the match form, when logging a new match).
        onSubmit={(event) => event.stopPropagation()}
      >
        <header className="border-b border-border px-5 pt-5 pb-4 sm:px-6">
          <div className="flex items-center gap-2 pr-8">
            <MapPinned className="size-4 text-primary" aria-hidden />
            <DialogTitle className="heading text-title">Import GPS tracking</DialogTitle>
          </div>
          <DialogDescription className="mt-1 text-xs text-muted-foreground">
            Turns a GPS recording into a heatmap and metrics for this match. It never changes your rating, stats or progression.
          </DialogDescription>
          <div className="mt-3">
            <StepList current={step} reachable={reachable} onGo={setStep} />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <h2 ref={heading} tabIndex={-1} className="eyebrow mb-4 outline-none">
            Step {position + 1} of {STEPS.length}: {STEPS[position].label}
          </h2>
          {step === "file" ? <FileStep busy={reading} error={fileError} onFile={onFile} manualHref={manualHref} /> : null}
          {step === "preview" && loaded ? (
            <PreviewStep
              parsed={loaded.parsed}
              fileName={loaded.name}
              matchDate={target.kind === "existing" ? target.match.date : target.date}
              duplicateNotice={
                duplicate ? <DuplicateNotice duplicate={duplicate} matches={matches} currentMatchId={currentMatchId} acknowledged={acknowledged} onAcknowledge={setAcknowledged} /> : null
              }
            />
          ) : null}
          {step === "trim" && loaded ? <TrimStep parsed={loaded.parsed} intervals={intervals} onChange={setIntervals} /> : null}
          {step === "calibrate" && loaded ? (
            <CalibrateStep
              parsed={loaded.parsed}
              draft={draft}
              onChange={setDraft}
              intervals={intervalCheck?.intervals ?? intervals}
              result={result}
              processing={processing}
              processError={processError}
              backend={backend}
            />
          ) : null}
          {step === "heatmap" ? <HeatmapStep result={result} processing={processing} error={processError} manualHref={manualHref} /> : null}
          {step === "attach" && result ? <AttachStep target={target} result={result} backend={backend} fileName={loaded?.name ?? null} /> : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 sm:px-6">
          <Button variant="ghost" onClick={() => (position > 0 ? setStep(STEPS[position - 1].id) : onOpenChange(false))} disabled={saving} data-icon="inline-start">
            <ArrowLeft /> {position > 0 ? "Back" : "Cancel"}
          </Button>
          <div className="flex items-center gap-3">
            {blockers[step] && step !== "file" ? (
              <p className="hidden text-xs text-muted-foreground sm:block" role="status">
                {blockers[step]}
              </p>
            ) : null}
            {step === "file" ? null : step === "attach" ? (
              <Button variant="cta" size="lg" onClick={attach} disabled={saving || !result || (target.kind === "existing" && !backend)} data-icon="inline-start">
                {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}
                {saving ? "Saving…" : nextLabel}
              </Button>
            ) : (
              <Button onClick={() => next && setStep(next.id)} disabled={Boolean(blockers[step])} data-icon="inline-end">
                {nextLabel} <ArrowRight />
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
