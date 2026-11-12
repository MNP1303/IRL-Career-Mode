"use client";

import { useMemo } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { AlertTriangle, Plus, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groundDistance } from "@/lib/gps/geo";
import { checkIntervals, defaultIntervals, intervalsFromSegments, MAX_INTERVALS, playingTimeMs, type PlayingInterval } from "@/lib/gps/trim";
import type { ParsedFile } from "@/lib/gps/worker-protocol";
import { formatClock, formatDuration, fromTimeInput, toTimeInput } from "@/components/gps/format";

const BINS = 240;

/** Speed and heart rate across the recording, binned for a quick visual of where play happened. */
function useProfile(parsed: ParsedFile) {
  return useMemo(() => {
    const { activity, screen } = parsed;
    const span = Math.max(1, activity.endTime - activity.startTime);
    const distance = new Float64Array(BINS);
    const time = new Float64Array(BINS);
    let previous: (typeof screen.points)[number] | null = null;
    for (const point of screen.points) {
      if (point.excluded) continue;
      if (previous && !point.breakBefore && point.t - previous.t <= screen.gapMs) {
        const bin = Math.min(BINS - 1, Math.floor(((point.t - activity.startTime) / span) * BINS));
        distance[bin] += groundDistance(previous, point);
        time[bin] += (point.t - previous.t) / 1000;
      }
      previous = point;
    }
    const speed = Array.from(distance, (d, i) => (time[i] > 0 ? d / time[i] : null));
    const hrSum = new Float64Array(BINS);
    const hrCount = new Float64Array(BINS);
    for (const sample of activity.heartRate) {
      const bin = Math.min(BINS - 1, Math.max(0, Math.floor(((sample.t - activity.startTime) / span) * BINS)));
      hrSum[bin] += sample.bpm;
      hrCount[bin] += 1;
    }
    const hr = Array.from(hrSum, (sum, i) => (hrCount[i] ? sum / hrCount[i] : null));
    const maxSpeed = Math.max(1, ...speed.map((value) => value ?? 0));
    const hrValues = hr.filter((value): value is number => value !== null);
    return { speed, hr, maxSpeed, hrMin: Math.min(...hrValues, 60), hrMax: Math.max(...hrValues, 180) };
  }, [parsed]);
}

function Timeline({ parsed, intervals }: { parsed: ParsedFile; intervals: PlayingInterval[] }) {
  const { activity, screen } = parsed;
  const profile = useProfile(parsed);
  const span = Math.max(1, activity.endTime - activity.startTime);
  const x = (t: number) => ((t - activity.startTime) / span) * BINS;
  const speedPath = profile.speed
    .map((value, index) => `${index === 0 ? "M" : "L"}${index + 0.5} ${40 - ((value ?? 0) / profile.maxSpeed) * 36}`)
    .join(" ");
  const hrPoints = profile.hr.map((value, index) => (value === null ? null : `${index + 0.5},${40 - ((value - profile.hrMin) / (profile.hrMax - profile.hrMin || 1)) * 36}`));
  return (
    <figure>
      <svg viewBox={`0 0 ${BINS} 44`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Speed across the recording, with your playing intervals highlighted">
        {intervals.map((interval, index) => (
          <rect key={index} x={x(interval.start)} width={Math.max(0.5, x(interval.end) - x(interval.start))} y={0} height={44} fill="#c8ff00" fillOpacity={0.12} />
        ))}
        {screen.gaps.map((gap, index) => (
          <rect key={`gap-${index}`} x={x(gap.start)} width={Math.max(0.5, x(gap.end) - x(gap.start))} y={0} height={44} fill="#ff5f52" fillOpacity={0.12} />
        ))}
        <path d={`${speedPath} L${BINS} 40 L0 40 Z`} fill="#f2f0e9" fillOpacity={0.16} />
        <path d={speedPath} fill="none" stroke="#f2f0e9" strokeOpacity={0.7} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        {hrPoints.some(Boolean) ? (
          <polyline points={hrPoints.filter(Boolean).join(" ")} fill="none" stroke="#ff5f52" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
        {intervals.map((interval, index) => (
          <g key={`edge-${index}`} stroke="#c8ff00" strokeWidth={1.2} vectorEffect="non-scaling-stroke">
            <line x1={x(interval.start)} x2={x(interval.start)} y1={0} y2={44} vectorEffect="non-scaling-stroke" />
            <line x1={x(interval.end)} x2={x(interval.end)} y1={0} y2={44} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{formatClock(activity.startTime)}</span>
        <span className="flex flex-wrap gap-3">
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-2 w-3 bg-[#f2f0e9]/50" /> Speed
          </span>
          {hrPoints.some(Boolean) ? (
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-0.5 w-3 bg-[#ff5f52]" /> Heart rate
            </span>
          ) : null}
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-2 w-3 bg-primary/30" /> Playing
          </span>
          {screen.gaps.length ? (
            <span className="flex items-center gap-1">
              <span aria-hidden className="h-2 w-3 bg-[#ff5f52]/30" /> Not recording
            </span>
          ) : null}
        </span>
        <span>{formatClock(activity.endTime)}</span>
      </figcaption>
    </figure>
  );
}

function IntervalRow({
  index,
  interval,
  parsed,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  interval: PlayingInterval;
  parsed: ParsedFile;
  onChange: (interval: PlayingInterval) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { startTime, endTime } = parsed.activity;
  const label = `Interval ${index + 1}`;
  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {label} <span className="font-normal text-muted-foreground">· {formatDuration(interval.end - interval.start)}</span>
        </p>
        <div className="flex items-center gap-2">
          {index > 0 ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[#c8ff00]"
                checked={Boolean(interval.switchedEnds)}
                onChange={(event) => onChange({ ...interval, switchedEnds: event.target.checked || undefined })}
              />
              Teams switched ends
            </label>
          ) : null}
          {canRemove ? (
            <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
      <SliderPrimitive.Root
        value={[interval.start, interval.end]}
        min={startTime}
        max={endTime}
        step={1000}
        largeStep={60_000}
        minStepsBetweenValues={10}
        onValueChange={(value) => {
          const [start, end] = value as number[];
          onChange({ ...interval, start, end });
        }}
        className="py-2"
      >
        <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none">
          <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
            <SliderPrimitive.Indicator className="h-full bg-primary" />
          </SliderPrimitive.Track>
          {[0, 1].map((thumb) => (
            <SliderPrimitive.Thumb
              key={thumb}
              index={thumb}
              getAriaLabel={(i) => `${label} ${i === 0 ? "start" : "end"}`}
              getAriaValueText={(_, value) => formatClock(value)}
              className="relative block size-5 shrink-0 rounded-full border-2 border-primary bg-background ring-ring/40 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
            />
          ))}
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["start", "end"] as const).map((edge) => (
          <label key={edge} className="text-xs text-muted-foreground">
            <span className="mb-1 block">{edge === "start" ? "Starts" : "Ends"}</span>
            <Input
              type="time"
              step={1}
              value={toTimeInput(interval[edge])}
              aria-label={`${label} ${edge}`}
              onChange={(event) => {
                const t = fromTimeInput(event.target.value, interval[edge]);
                if (t !== null) onChange({ ...interval, [edge]: t });
              }}
            />
          </label>
        ))}
      </div>
    </li>
  );
}

export function TrimStep({
  parsed,
  intervals,
  onChange,
}: {
  parsed: ParsedFile;
  intervals: PlayingInterval[];
  onChange: (intervals: PlayingInterval[]) => void;
}) {
  const { activity } = parsed;
  const check = useMemo(() => checkIntervals(intervals, activity), [intervals, activity]);
  const segments = useMemo(() => intervalsFromSegments(activity), [activity]);
  const playing = playingTimeMs(check.intervals, activity);

  function addInterval() {
    const last = [...intervals].sort((a, b) => a.end - b.end).at(-1);
    const start = last ? Math.min(activity.endTime - 60_000, last.end + 60_000) : activity.startTime;
    const end = Math.min(activity.endTime, start + 10 * 60_000);
    onChange([...intervals, { start: Math.max(activity.startTime, start), end }]);
  }

  /** Splits the interval holding the midpoint of the longest interval into two with a two-minute break. */
  function splitLongest() {
    const longest = [...intervals].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!longest) return;
    const middle = Math.round((longest.start + longest.end) / 2);
    onChange(
      intervals.flatMap((interval) =>
        interval === longest
          ? [
              { ...interval, end: middle - 60_000 },
              { start: middle + 60_000, end: interval.end },
            ]
          : [interval],
      ),
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Mark only the time you were actually playing, so warm-ups, half-time and breaks don’t count. Add as many intervals as you played; nothing
        assumes two halves. Intervals are never joined to each other, and the original timestamps are kept.
      </p>
      <Timeline parsed={parsed} intervals={check.intervals} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={addInterval} disabled={intervals.length >= MAX_INTERVALS} data-icon="inline-start">
          <Plus /> Add interval
        </Button>
        <Button variant="secondary" size="sm" onClick={splitLongest} disabled={intervals.length >= MAX_INTERVALS} data-icon="inline-start">
          <Scissors /> Split for a break
        </Button>
        {segments.length > 1 ? (
          <Button variant="secondary" size="sm" onClick={() => onChange(segments)} data-icon="inline-start">
            Use the {segments.length} recorded segments
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => onChange(defaultIntervals(activity))} data-icon="inline-start">
          <RotateCcw /> Whole recording
        </Button>
      </div>
      <ol className="space-y-3">
        {intervals.map((interval, index) => (
          <IntervalRow
            key={index}
            index={index}
            interval={interval}
            parsed={parsed}
            canRemove={intervals.length > 1}
            onChange={(next) => onChange(intervals.map((item, i) => (i === index ? next : item)))}
            onRemove={() => onChange(intervals.filter((_, i) => i !== index))}
          />
        ))}
      </ol>
      <div role="status" aria-live="polite" className="space-y-1.5 text-sm">
        <p>
          Playing time: <span className="font-semibold">{formatDuration(playing)}</span>
          <span className="text-muted-foreground"> of {formatDuration(activity.endTime - activity.startTime)} recorded</span>
        </p>
        {[...check.errors, ...check.warnings].map((message) => (
          <p key={message} className="flex gap-2">
            <AlertTriangle className={check.errors.includes(message) ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-[#f5c542]"} aria-hidden />
            <span>
              <span className="sr-only">{check.errors.includes(message) ? "Error: " : "Warning: "}</span>
              {message}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}
