"use client";

import Link from "next/link";
import { ChevronRight, MapPin, NotebookPen } from "lucide-react";
import { RatingChip, ResultBadge } from "@/components/shared/primitives";
import type { Match } from "@/lib/schema";
import { formatDay, scoreline } from "@/lib/stats";

const MONTHS = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

function Contribution({ goals, assists }: { goals: number; assists: number }) {
  if (goals === 0 && assists === 0) return <span className="text-faint">–</span>;
  return (
    <span className="stat text-sm">
      {goals > 0 ? `${goals}G` : null}
      {goals > 0 && assists > 0 ? " " : null}
      {assists > 0 ? `${assists}A` : null}
    </span>
  );
}

export function MatchRow({ match, xp }: { match: Match; xp?: number }) {
  const score = scoreline(match);
  return (
    <li>
      <Link
        href={`/matches/${match.id}`}
        className="group relative flex min-h-16 items-center gap-3 px-3 py-2.5 outline-none transition-colors duration-(--dur-hover) hover:bg-white/[0.035] active:bg-white/[0.06] focus-visible:bg-white/[0.05] sm:gap-4 sm:px-4"
      >
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 origin-center scale-y-0 bg-primary transition-transform group-hover:scale-y-100 group-focus-visible:scale-y-100"
        />
        <span className="hidden w-10 shrink-0 text-center sm:block">
          <span className="sr-only">{formatDay(match.date)}</span>
          <span aria-hidden className="numeral block text-[1.375rem]">{Number(match.date.slice(8, 10))}</span>
          <span aria-hidden className="eyebrow mt-0.5 block text-[0.625rem]">{MONTHS.format(new Date(`${match.date}T00:00:00Z`))}</span>
        </span>
        <ResultBadge result={match.result} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">
              {match.opponent ? `vs ${match.opponent}` : `${match.format} match`}
            </span>
            {match.isSample ? (
              <span className="eyebrow shrink-0 text-[0.625rem] text-faint">Demo</span>
            ) : null}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="sm:hidden">{formatDay(match.date)} ·</span>
            <span>{match.format}</span>
            <span aria-hidden>·</span>
            <span>{match.position}</span>
            <span aria-hidden>·</span>
            <span>{match.minutes}&prime;</span>
            {match.zones.length ? <MapPin className="size-3 text-faint" aria-label="Pitch map recorded" /> : null}
            {match.notes ? <NotebookPen className="size-3 text-faint" aria-label="Has notes" /> : null}
          </span>
        </span>
        {score ? (
          <span className="stat hidden w-14 shrink-0 text-center text-base font-bold sm:block">
            {score}
          </span>
        ) : (
          <span className="hidden w-14 shrink-0 sm:block" />
        )}
        <span className="hidden w-16 shrink-0 text-center md:block">
          <Contribution goals={match.goals} assists={match.assists} />
        </span>
        <RatingChip rating={match.rating} />
        {xp !== undefined ? (
          <span className="hidden w-16 shrink-0 text-right text-xs font-medium text-muted-foreground tabular-nums lg:block">
            +{xp} XP
          </span>
        ) : null}
        <ChevronRight className="hidden size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 sm:block" />
      </Link>
    </li>
  );
}
