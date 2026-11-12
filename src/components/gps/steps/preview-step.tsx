"use client";

import { useMemo } from "react";
import { AlertTriangle, Copy } from "lucide-react";
import { summariseActivity } from "@/lib/gps/pipeline";
import type { DuplicateReport } from "@/lib/gps/service";
import type { ParsedFile } from "@/lib/gps/worker-protocol";
import { formatDate } from "@/lib/stats";
import type { Match } from "@/lib/schema";
import { RouteMap } from "@/components/gps/route-map";
import { MetricList } from "@/components/gps/metrics";
import { formatClock, formatDay, formatDuration, localIsoDate } from "@/components/gps/format";

function matchName(match: Match | undefined) {
  if (!match) return "a match that's no longer in your career";
  return `your ${formatDate(match.date)} match${match.opponent ? ` vs ${match.opponent}` : ""}`;
}

export function DuplicateNotice({
  duplicate,
  matches,
  currentMatchId,
  acknowledged,
  onAcknowledge,
}: {
  duplicate: DuplicateReport;
  matches: Match[];
  currentMatchId?: string;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}) {
  const others = duplicate.attachedTo.filter((id) => id !== currentMatchId);
  const sameMatch = currentMatchId !== undefined && duplicate.attachedTo.includes(currentMatchId);
  const exact = duplicate.match.kind === "exact";
  const existing = duplicate.match.existing;
  let message: string;
  if (exact && sameMatch && !others.length) {
    message = "This exact file is already attached to this match. Continuing replaces its GPS settings (trim and pitch); nothing else changes.";
  } else if (exact && others.length) {
    message = `This exact file is already attached to ${others.map((id) => matchName(matches.find((m) => m.id === id))).join(" and ")}. Attaching it here too would count the same recording twice.`;
  } else if (exact) {
    message = "This exact file was uploaded before but isn't attached to any match. It will be re-used rather than uploaded again.";
  } else {
    message = `This looks like a recording you've already imported (${formatDay(existing.startedAt)}, ${formatClock(existing.startedAt)}–${formatClock(existing.endedAt)}). ${
      duplicate.match.kind === "likely" ? duplicate.match.reason : ""
    }`;
  }
  const needsConsent = !(exact && sameMatch && !others.length) && !(exact && !duplicate.attachedTo.length);
  return (
    <div role="status" className="rounded-lg border border-[#f5c542]/35 bg-[#f5c542]/6 p-4">
      <p className="flex items-center gap-2 font-semibold text-[#f5c542]">
        <Copy className="size-4" aria-hidden /> {exact ? "Already imported" : "Possible duplicate"}
      </p>
      <p className="mt-1 text-sm">{message}</p>
      {needsConsent ? (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#c8ff00]" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} />
          <span>I understand. Continue with this file anyway.</span>
        </label>
      ) : null}
    </div>
  );
}

export function duplicateNeedsConsent(duplicate: DuplicateReport | null, currentMatchId?: string) {
  if (!duplicate) return false;
  const others = duplicate.attachedTo.filter((id) => id !== currentMatchId);
  const exact = duplicate.match.kind === "exact";
  const sameMatch = currentMatchId !== undefined && duplicate.attachedTo.includes(currentMatchId);
  if (exact && sameMatch && !others.length) return false;
  if (exact && !duplicate.attachedTo.length) return false;
  return true;
}

export function PreviewStep({
  parsed,
  fileName,
  matchDate,
  duplicateNotice,
}: {
  parsed: ParsedFile;
  fileName: string | null;
  matchDate?: string;
  duplicateNotice?: React.ReactNode;
}) {
  const { activity, screen } = parsed;
  const overview = useMemo(() => summariseActivity(activity, screen), [activity, screen]);
  const activityDate = localIsoDate(activity.startTime);
  const facts: [string, string][] = [
    ["Date", formatDay(activity.startTime)],
    ["Time", `${formatClock(activity.startTime)} – ${formatClock(activity.endTime)}`],
    ["Duration", formatDuration(overview.durationMs)],
    ["GPS points", activity.pointCount.toLocaleString("en-GB")],
    ["Format", `${activity.provenance.format.toUpperCase()}${activity.provenance.creator ? ` · ${activity.provenance.creator}` : ""}`],
    ["Sampling", `about every ${Math.max(1, Math.round(screen.sampling.medianMs / 1000))} s`],
  ];

  return (
    <div className="space-y-5">
      {duplicateNotice}
      {matchDate && matchDate !== activityDate ? (
        <p role="status" className="flex gap-2 rounded-lg border border-[#f5c542]/35 bg-[#f5c542]/6 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#f5c542]" aria-hidden />
          <span>
            This recording is from {formatDay(activity.startTime)}, but the match is logged on {formatDate(matchDate)}. Check it’s the right file.
          </span>
        </p>
      ) : null}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <RouteMap screen={screen} label={`Recorded route${fileName ? ` from ${fileName}` : ""}, north up. Red crosses mark points left out as GPS errors.`} />
          <p className="mt-2 text-xs text-muted-foreground">North is up. Red crosses mark points that look like GPS errors. No map is loaded, so your location isn’t sent anywhere.</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 self-start md:grid-cols-1">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="eyebrow">{label}</dt>
              <dd className="mt-1 text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="eyebrow mb-1">Whole recording</h3>
          <p className="mb-2 text-xs text-muted-foreground">Before trimming: includes any warm-up and breaks.</p>
          <MetricList metrics={overview.metrics} compact />
        </section>
        <section>
          <h3 className="eyebrow mb-2">What we noticed</h3>
          {overview.warnings.length ? (
            <ul className="space-y-2 text-sm">
              {overview.warnings.map((warning) => (
                <li key={warning} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#f5c542]" aria-label="Note:" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing unusual: a steady, continuous recording.</p>
          )}
        </section>
      </div>
    </div>
  );
}
