"use client";

import {
  ViewTransition,
  addTransitionType,
  startTransition,
  useMemo,
  useState,
} from "react";
import { BarChart3 } from "lucide-react";
import {
  AttributeSparks,
  ContributionCharts,
  OvrChart,
  RatingTrendChart,
} from "@/components/career/charts";
import {
  AchievementGrid,
  MilestoneTimeline,
} from "@/components/career/honours";
import { HowItWorks } from "@/components/career/how-it-works";
import {
  CountUp,
  EmptyState,
  LinkButton,
  PageHeader,
  Reveal,
  SectionTitle,
  Segmented,
  TabBar,
} from "@/components/shared/primitives";
import { ALL_TIME, inScope, seasonOf, seasonsIn, summarise } from "@/lib/stats";
import { useCareer } from "@/lib/store";

type Tab = "development" | "performance" | "honours" | "rules";

const TABS = [
  { value: "development", label: "Development" },
  { value: "performance", label: "Performance" },
  { value: "honours", label: "Honours" },
  { value: "rules", label: "How it works" },
] as const;

function Figure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="stat mt-2.5 text-stat-lg">{children}</p>
    </div>
  );
}

export function CareerScreen() {
  const { career, matches, profile } = useCareer();
  const [tab, setTab] = useState<Tab>("development");

  // Tabs slide in the direction you move along the bar, as a view transition.
  function chooseTab(next: Tab) {
    const from = TABS.findIndex((option) => option.value === tab);
    const to = TABS.findIndex((option) => option.value === next);
    startTransition(() => {
      addTransitionType(to > from ? "tab-forward" : "tab-back");
      setTab(next);
    });
  }
  const seasons = useMemo(() => seasonsIn(matches), [matches]);
  const [scope, setScope] = useState<string>(ALL_TIME);

  const scoped = useMemo(() => inScope(matches, scope), [matches, scope]);
  const timeline = useMemo(
    () =>
      scope === ALL_TIME
        ? career.timeline
        : career.timeline.filter(
            (entry) => seasonOf(entry.match.date) === scope,
          ),
    [career, scope],
  );
  const summary = summarise(scoped);
  const unlocked = career.achievements.filter(
    (entry) => entry.unlockedOn,
  ).length;
  const needsData =
    matches.length === 0 && (tab === "development" || tab === "performance");
  const showScope = tab === "development" || tab === "performance";

  return (
    <Reveal>
      <PageHeader
        eyebrow="Career"
        title="Your development"
        description="Every number here is rebuilt from your match log, so it always reflects what you've actually recorded."
      />

      <div className="mb-section flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border">
        <div className="scrollbar-none -mx-gutter -mb-px max-w-[100vw] overflow-x-auto px-gutter sm:mx-0 sm:px-0">
          <TabBar
            label="Career section"
            value={tab}
            onChange={chooseTab}
            options={TABS}
            className="border-b-0"
          />
        </div>
        {showScope && seasons.length > 0 ? (
          <Segmented
            label="Period"
            size="sm"
            className="mb-2"
            value={scope}
            onChange={setScope}
            options={[
              { value: ALL_TIME, label: "Career" },
              ...seasons.map((season) => ({ value: season, label: season })),
            ]}
          />
        ) : null}
      </div>

      {needsData ? (
        <EmptyState
          icon={<BarChart3 />}
          title="Nothing to chart yet"
          action={
            <LinkButton href="/matches/new" variant="cta" size="lg">
              Log a match
            </LinkButton>
          }
        >
          Your first match draws the first point on every chart here.
        </EmptyState>
      ) : null}

      <ViewTransition
        key={tab}
        enter={{
          "tab-forward": "tab-forward",
          "tab-back": "tab-back",
          default: "none",
        }}
        exit={{
          "tab-forward": "tab-forward",
          "tab-back": "tab-back",
          default: "none",
        }}
        default="none"
      >
        <div>
          {!needsData && tab === "development" ? (
            <div className="space-y-block">
              <section className="panel p-card">
                <SectionTitle
                  title="OVR progression"
                  aside={`Best ${career.peakOvr} · Now ${career.ovr}`}
                />
                {timeline.length > 1 ? (
                  <OvrChart timeline={timeline} height={280} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Log another match in this period to draw a trend.
                  </p>
                )}
              </section>
              <section className="panel p-card">
                <SectionTitle
                  title="Attribute development"
                  aside="Since your baseline, career to date"
                />
                <AttributeSparks career={career} />
              </section>
            </div>
          ) : null}

          {!needsData && tab === "performance" ? (
            <div className="space-y-block">
              <section className="panel grid grid-cols-2 gap-x-block gap-y-6 p-card sm:grid-cols-4">
                <Figure label="Matches">
                  <CountUp value={summary.matches} />
                </Figure>
                <Figure label="Avg rating">
                  {summary.averageRating ? (
                    <CountUp value={summary.averageRating} decimals={2} />
                  ) : (
                    "–"
                  )}
                </Figure>
                <Figure label="Goals + assists">
                  <CountUp value={summary.goals + summary.assists} />
                </Figure>
                <Figure label="Record">
                  {summary.wins}W {summary.draws}D {summary.losses}L
                </Figure>
              </section>
              {timeline.length > 0 ? (
                <>
                  <section className="panel p-card">
                    <SectionTitle title="Performance trend" />
                    <RatingTrendChart timeline={timeline} />
                  </section>
                  <section className="panel p-card">
                    <SectionTitle title="Goal contributions" />
                    <ContributionCharts matches={scoped} />
                  </section>
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "honours" ? (
            <>
              <section className="brand-pattern brand-feature mb-block overflow-hidden rounded-xl border border-border p-card sm:px-7 sm:py-6">
                <p className="eyebrow">Honours</p>
                <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-4">
                  <div>
                    <p className="stat text-stat-xl">
                      {unlocked}
                      <span className="text-stat font-medium text-foreground/60">
                        {" "}
                        / {career.achievements.length}
                      </span>
                    </p>
                    <p className="mt-2 text-xs font-medium text-foreground/70">
                      Badges earned
                    </p>
                  </div>
                  <div>
                    <p className="stat text-stat-lg">
                      {career.milestones.length}
                    </p>
                    <p className="mt-2 text-xs font-medium text-foreground/70">
                      Career milestones
                    </p>
                  </div>
                </div>
              </section>
              <div className="grid grid-cols-1 items-start gap-block xl:grid-cols-[minmax(0,1fr)_380px]">
                <section className="panel p-card">
                  <SectionTitle
                    title="Badges"
                    aside={`${unlocked} of ${career.achievements.length}`}
                  />
                  <AchievementGrid achievements={career.achievements} />
                </section>
                <section className="panel p-card">
                  <SectionTitle title="Career timeline" />
                  {career.milestones.length ? (
                    <MilestoneTimeline milestones={career.milestones} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Milestones appear here as you log matches.
                    </p>
                  )}
                </section>
              </div>
            </>
          ) : null}

          {tab === "rules" ? (
            <HowItWorks career={career} primary={profile.positions[0]} />
          ) : null}
        </div>
      </ViewTransition>
    </Reveal>
  );
}
