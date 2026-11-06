"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPinOff,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BadgeMedal } from "@/components/career/badge-medal";
import { MatchForm } from "@/components/match/match-form";
import { Tilt } from "@/components/motion/tilt";
import {
  HeatLayer,
  HeatLegend,
  ZoneBreakdown,
} from "@/components/pitch/heat-layer";
import {
  AttackHint,
  Pitch,
  usePitchOrientation,
} from "@/components/pitch/pitch";
import {
  EmptyState,
  LinkButton,
  PageHeader,
  RatingChip,
  Reveal,
  ResultBadge,
  SectionTitle,
} from "@/components/shared/primitives";
import { ATTRIBUTES, POSITION_META, RESULT_META } from "@/lib/domain";
import { ratingBand } from "@/lib/engine/progression";
import { gridFromCells } from "@/lib/heatmap";
import { formatDate, scoreline } from "@/lib/stats";
import { actions, useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";

function MissingMatch() {
  return (
    <EmptyState
      icon={<MapPinOff />}
      title="Match not found"
      action={
        <LinkButton href="/matches" variant="outline">
          Back to matches
        </LinkButton>
      }
    >
      It may have been deleted, or it was logged in a different browser.
    </EmptyState>
  );
}

export function MatchEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { career } = useCareer();
  const entry = career.byMatchId.get(id);
  if (!entry) return <MissingMatch />;
  return (
    <Reveal>
      <PageHeader
        eyebrow="Match log"
        title="Edit match"
        description="Saving recalculates your whole career from this match onwards."
      />
      {/* Keyed on content because visited routes stay mounted between saves. */}
      <MatchForm key={JSON.stringify(entry.match)} editing={entry.match} />
    </Reveal>
  );
}

export function MatchDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const orientation = usePitchOrientation();
  const { career } = useCareer();
  const [confirming, setConfirming] = useState(false);

  const entry = career.byMatchId.get(id);
  const index = career.timeline.findIndex((item) => item.match.id === id);
  const previous = career.timeline[index - 1]?.match;
  const next = career.timeline[index + 1]?.match;
  const grid = useMemo(() => gridFromCells(entry?.match.zones ?? []), [entry]);

  if (!entry) return <MissingMatch />;
  const { match } = entry;
  const score = scoreline(match);

  function onDelete() {
    actions.deleteMatch(match.id);
    setConfirming(false);
    router.push("/matches");
    toast("Match deleted", {
      description: "Your career has been recalculated.",
      action: { label: "Undo", onClick: () => actions.restoreMatch(match) },
    });
  }

  return (
    <Reveal>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/matches"
          className="eyebrow inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All matches
        </Link>
        <div className="flex items-center gap-2">
          <LinkButton
            href={`/matches/${match.id}/edit`}
            variant="outline"
            size="sm"
            data-icon="inline-start"
          >
            <Pencil />
            Edit
          </LinkButton>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirming(true)}
            data-icon="inline-start"
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <Tilt max={3}>
        <section className="panel overflow-hidden p-card sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex items-center gap-4 sm:gap-6">
              <ResultBadge result={match.result} size="lg" />
              <div>
                <p className="eyebrow">
                  {formatDate(match.date)} · {match.format}
                  {match.isSample ? " · Demo data" : ""}
                </p>
                <h1 className="stat mt-2 text-stat-xl">
                  {score ?? RESULT_META[match.result].label}
                </h1>
                <p className="mt-2 text-base font-semibold">
                  {match.opponent
                    ? `vs ${match.opponent}`
                    : "Opponent not recorded"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="eyebrow mb-2">Match rating</p>
              <p className="stat text-stat-xl text-primary">
                {match.rating.toFixed(1)}
              </p>
              <p className="mt-2 text-xs font-semibold text-muted-foreground">
                {ratingBand(match.rating)}
              </p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-border pt-5 sm:grid-cols-4">
            {[
              ["Position", POSITION_META[match.position].name],
              ["Minutes", `${match.minutes}′`],
              ["Goals", match.goals],
              ["Assists", match.assists],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="eyebrow">{label}</dt>
                <dd className="stat mt-2 text-stat">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </Tilt>

      <div className="mt-block grid grid-cols-1 gap-block lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-block">
          <section className="panel p-card">
            <SectionTitle
              title="Match heatmap"
              aside={
                match.zones.length ? (
                  <AttackHint orientation={orientation} />
                ) : null
              }
            />
            {match.zones.length ? (
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_230px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_230px]">
                <div>
                  <div className="mx-auto max-w-[min(100%,52vh)] sm:max-w-none">
                    <Pitch
                      decorative
                      orientation={orientation}
                      label={`Activity heatmap for this match, ${match.zones.length} zones recorded`}
                      underlay={<HeatLayer grid={grid} />}
                    />
                  </div>
                  <HeatLegend className="mt-3" />
                </div>
                <ZoneBreakdown grid={grid} />
              </div>
            ) : (
              <EmptyState
                icon={<MapPinOff />}
                title="No map recorded"
                action={
                  <LinkButton
                    href={`/matches/${match.id}/edit`}
                    variant="outline"
                    size="sm"
                  >
                    Add pitch map
                  </LinkButton>
                }
              >
                This match won&apos;t appear in your season heatmap until zones
                are added.
              </EmptyState>
            )}
          </section>

          {match.notes ? (
            <section className="panel p-card">
              <SectionTitle title="Notes" />
              <p className="text-sm whitespace-pre-wrap text-foreground/90">
                {match.notes}
              </p>
            </section>
          ) : null}
        </div>

        <div className="space-y-block">
          <section className="panel p-card">
            <SectionTitle
              title="XP earned"
              aside={
                <span className="stat text-stat-sm text-primary">
                  +{entry.xpGained}
                </span>
              }
            />
            <ul className="space-y-1.5 text-sm">
              {entry.xpLines.map((line) => (
                <li
                  key={line.label}
                  className="flex justify-between gap-3 text-muted-foreground"
                >
                  <span>{line.label}</span>
                  <span className="font-medium text-foreground tabular-nums">
                    +{line.amount}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel p-card">
            <SectionTitle
              title="Development"
              aside={
                <span className="stat text-sm font-bold text-foreground">
                  OVR {entry.ovrBefore}
                  {entry.ovrAfter !== entry.ovrBefore
                    ? ` → ${entry.ovrAfter}`
                    : ""}
                </span>
              }
            />
            {entry.changes.length ? (
              <ul className="space-y-2.5">
                {entry.changes.map((change) => (
                  <li
                    key={change.key}
                    className="flex items-center gap-3 text-sm"
                  >
                    <span className="w-9 font-display text-xs font-bold tracking-wide">
                      {ATTRIBUTES[change.key].code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {change.reason}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {change.before.toFixed(1)} → {change.after.toFixed(1)}
                    </span>
                    <span
                      className={cn(
                        "w-9 text-right font-semibold tabular-nums",
                        change.delta >= 0 ? "text-primary" : "text-loss",
                      )}
                    >
                      {change.delta >= 0 ? "+" : "−"}
                      {Math.abs(change.delta).toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No skills were rated, so no attributes changed.
              </p>
            )}
          </section>

          {entry.unlocked.length ? (
            <section className="panel p-card">
              <SectionTitle title="Unlocked here" />
              <ul className="space-y-3">
                {entry.unlocked.map((badge) => (
                  <li key={badge.id} className="flex items-center gap-3">
                    <BadgeMedal
                      icon={badge.icon}
                      rarity={badge.rarity}
                      className="size-11"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold">{badge.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {badge.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <nav aria-label="Other matches" className="mt-6 grid grid-cols-2 gap-3">
        {[previous, next].map((neighbour, position) =>
          neighbour ? (
            <Link
              key={neighbour.id}
              href={`/matches/${neighbour.id}`}
              className={cn(
                "panel lift flex items-center gap-3 p-3 hover:border-foreground/25 sm:p-4",
                position === 1 && "col-start-2 flex-row-reverse text-right",
              )}
            >
              {position === 0 ? (
                <ChevronLeft className="size-4 shrink-0" />
              ) : (
                <ChevronRight className="size-4 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="eyebrow block">
                  {position === 0 ? "Previous" : "Next"}
                </span>
                <span className="block truncate text-sm font-semibold">
                  {neighbour.opponent ?? `${neighbour.format} match`}
                </span>
              </span>
              <RatingChip
                rating={neighbour.rating}
                className={cn(
                  "hidden sm:inline-flex",
                  position === 0 ? "ml-auto" : "mr-auto",
                )}
              />
            </Link>
          ) : null,
        )}
      </nav>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this match?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {entry.xpGained} XP, attribute changes and any badges it
              earned will be recalculated out of your career.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep match</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Delete match
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Reveal>
  );
}
