"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Goal as GoalIcon } from "lucide-react";
import { OvrChart } from "@/components/career/charts";
import { MilestoneTimeline, ObjectiveRow } from "@/components/career/honours";
import { MatchRow } from "@/components/match/match-row";
import { Tilt } from "@/components/motion/tilt";
import { PlayerCard } from "@/components/player/player-card";
import {
  CountUp,
  EmptyState,
  LinkButton,
  RatingChip,
  ResultBadge,
  Reveal,
  SectionTitle,
  Segmented,
  XpBar,
} from "@/components/shared/primitives";
import { POSITION_META, nationName } from "@/lib/domain";
import { chronological, nextObjectives } from "@/lib/engine/career";
import { levelTitle } from "@/lib/engine/progression";
import {
  ALL_TIME,
  formatDate,
  inScope,
  recentForm,
  scoreline,
  seasonsIn,
  summarise,
} from "@/lib/stats";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";

function StatBand({ stats }: { stats: ReturnType<typeof summarise> }) {
  const items = [
    { label: "Matches", value: stats.matches, span: "col-span-2" },
    { label: "Goals", value: stats.goals, span: "col-span-2" },
    { label: "Assists", value: stats.assists, span: "col-span-2" },
    {
      label: "Win rate",
      value: stats.winRate === null ? null : stats.winRate * 100,
      suffix: "%",
      span: "col-span-3",
    },
    { label: "Minutes", value: stats.minutes, span: "col-span-3" },
  ];

  return (
    <dl className="panel grid grid-cols-6 overflow-hidden sm:grid-cols-5">
      {items.map((item, index) => (
        <div
          key={item.label}
          data-reveal
          className={cn(
            item.span,
            "relative px-card py-4 sm:col-span-1",
            index > 0 && "sm:border-l sm:border-border",
            index < 3 && "max-sm:border-b max-sm:border-border",
            index > 0 && index !== 3 && "max-sm:border-l max-sm:border-border",
          )}
        >
          <dt className="eyebrow">{item.label}</dt>
          <dd className="stat mt-2.5 text-stat-lg">
            {item.value === null ? (
              "–"
            ) : (
              <CountUp value={item.value} suffix={item.suffix} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FormStrip({ matches }: { matches: Parameters<typeof recentForm>[0] }) {
  const form = recentForm(matches);
  const list = useRef<HTMLUListElement>(null);
  const key = form.map((match) => match.id).join();

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from("li", {
        opacity: 0,
        scale: 0.6,
        duration: 0.45,
        ease: EASE.pop,
        stagger: 0.06,
        delay: 0.45,
      });
    },
    { scope: list, dependencies: [key] },
  );

  return (
    <ul
      ref={list}
      className="flex gap-1.5"
      aria-label="Recent results, oldest first"
    >
      {form.map((match) => (
        <li key={match.id}>
          <Link href={`/matches/${match.id}`} title={match.opponent}>
            <ResultBadge result={match.result} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HubScreen() {
  const { profile, matches, career, isDemo } = useCareer();
  const seasons = useMemo(() => seasonsIn(matches), [matches]);
  const [scope, setScope] = useState<string>(seasons[0] ?? ALL_TIME);
  const activeScope =
    scope === ALL_TIME || seasons.includes(scope)
      ? scope
      : (seasons[0] ?? ALL_TIME);

  const scoped = useMemo(
    () => inScope(matches, activeScope),
    [matches, activeScope],
  );
  const stats = summarise(scoped);
  const position = profile.positions[0];
  const latest = chronological(matches).at(-1);
  const latestEntry = latest ? career.byMatchId.get(latest.id) : undefined;
  const recent = useMemo(
    () => chronological(matches).reverse().slice(0, 5),
    [matches],
  );
  const objectives = nextObjectives(career, 3);
  const empty = matches.length === 0;

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-section lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="lg:row-span-2">
        <div className="lg:sticky lg:top-24">
          <PlayerCard
            profile={profile}
            attributes={career.attributes}
            level={career.level.level}
            demo={profile.isSample}
            className="max-w-[280px] sm:max-w-[320px]"
          />
          <Reveal delay={0.25} className="mx-auto mt-5 max-w-[320px]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="heading text-base">
                Level {career.level.level}
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  {levelTitle(career.level.level)}
                </span>
              </p>
              <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {career.level.needed - career.level.into} XP to go
              </p>
            </div>
            <XpBar
              className="mt-2"
              progress={career.level.progress}
              label="Progress to next level"
            />
          </Reveal>
        </div>
      </div>

      <Reveal
        delay={0.05}
        stagger="[data-reveal]"
        className="min-w-0 space-y-block"
      >
        <div data-reveal>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="eyebrow flex items-center gap-2">
              <span className="h-0.5 w-4 bg-primary" aria-hidden />
              {activeScope === ALL_TIME
                ? "Full career"
                : `Season ${activeScope}`}
            </p>
            {seasons.length > 0 ? (
              <Segmented
                label="Period"
                size="sm"
                value={activeScope}
                onChange={setScope}
                options={[
                  ...seasons
                    .slice(0, 2)
                    .map((season) => ({ value: season, label: season })),
                  { value: ALL_TIME, label: "Career" },
                ]}
              />
            ) : null}
          </div>
          <h1 className="display mt-3 text-hero break-words">{profile.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {POSITION_META[position].name} · #{profile.shirtNumber} ·{" "}
            {nationName(profile.nationality)}
            {isDemo ? " · Demo career" : ""}
          </p>
        </div>

        <StatBand stats={stats} />

        {empty ? (
          <EmptyState
            icon={<GoalIcon />}
            title="Your career starts here"
            action={
              <LinkButton
                href="/matches/new"
                variant="cta"
                size="lg"
                data-icon="inline-end"
              >
                Log your first match
                <ArrowRight strokeWidth={3} />
              </LinkButton>
            }
          >
            Everyone starts at {career.ovr} OVR. Log real matches and your card
            develops from what you actually do.
          </EmptyState>
        ) : (
          <div className="grid gap-block md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {latest && latestEntry ? (
              <Tilt>
                <Link
                  href={`/matches/${latest.id}`}
                  data-reveal
                  className="surface-glass lift group block rounded-xl p-card outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="eyebrow">Latest match</h2>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(latest.date)}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <ResultBadge result={latest.result} size="lg" />
                    <p className="stat text-stat-xl">
                      {scoreline(latest) ?? latest.format}
                    </p>
                    <RatingChip
                      rating={latest.rating}
                      className="ml-auto h-10 min-w-14 text-lg"
                    />
                  </div>
                  <p className="mt-4 truncate text-sm font-semibold">
                    {latest.opponent
                      ? `vs ${latest.opponent}`
                      : `${latest.format} match`}
                    <span className="font-medium text-muted-foreground">
                      {" "}
                      · {latest.goals}G {latest.assists}A
                    </span>
                  </p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">
                    +{latestEntry.xpGained} XP
                    {latestEntry.ovrAfter > latestEntry.ovrBefore
                      ? ` · OVR ${latestEntry.ovrBefore} → ${latestEntry.ovrAfter}`
                      : ""}
                  </p>
                </Link>
              </Tilt>
            ) : null}
            <div
              data-reveal
              className="panel flex flex-col justify-between gap-4 p-card"
            >
              <div>
                <h2 className="eyebrow">Form</h2>
                <div className="mt-3">
                  <FormStrip matches={scoped.length ? scoped : matches} />
                </div>
              </div>
              <div className="flex items-end justify-between gap-4 border-t border-border pt-4">
                <div>
                  <p className="eyebrow">Avg rating</p>
                  <p className="stat mt-2 text-stat-lg">
                    {stats.averageRating ? stats.averageRating.toFixed(1) : "–"}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {stats.wins}W {stats.draws}D {stats.losses}L
                </p>
              </div>
            </div>
          </div>
        )}
      </Reveal>

      {!empty ? (
        <Reveal delay={0.12} className="min-w-0">
          <section className="panel p-card">
            <SectionTitle
              title="Rating progression"
              aside={
                <Link
                  href="/career"
                  className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                >
                  Full analysis <ArrowRight className="size-3.5" />
                </Link>
              }
            />
            {career.timeline.length > 1 ? (
              <OvrChart timeline={career.timeline} height={220} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Log one more match to draw your trend.
              </p>
            )}
          </section>
        </Reveal>
      ) : null}

      {!empty ? (
        <Reveal
          delay={0.16}
          className="grid min-w-0 gap-x-block gap-y-section lg:col-span-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
        >
          <section>
            <SectionTitle
              title="Recent matches"
              aside={
                <Link
                  href="/matches"
                  className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                >
                  All matches <ArrowRight className="size-3.5" />
                </Link>
              }
            />
            <ul className="panel divide-y divide-border overflow-hidden">
              {recent.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  xp={career.byMatchId.get(match.id)?.xpGained}
                />
              ))}
            </ul>
          </section>
          <div className="space-y-section">
            {objectives.length ? (
              <section>
                <SectionTitle title="Next objectives" />
                <ul className="panel space-y-4 p-card">
                  {objectives.map((entry) => (
                    <ObjectiveRow key={entry.def.id} entry={entry} />
                  ))}
                </ul>
              </section>
            ) : null}
            {career.milestones.length ? (
              <section>
                <SectionTitle
                  title="Latest milestones"
                  aside={
                    <Link
                      href="/career"
                      className="inline-flex items-center gap-1 transition-colors hover:text-primary"
                    >
                      All <ArrowRight className="size-3.5" />
                    </Link>
                  }
                />
                <div className="panel p-2 sm:p-3">
                  <MilestoneTimeline milestones={career.milestones} limit={3} />
                </div>
              </section>
            ) : null}
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
