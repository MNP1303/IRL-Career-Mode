"use client";

import { ScrollReveal } from "@/components/motion/scroll-reveal";
import { useMemo, useState } from "react";
import { ArrowUpDown, CalendarPlus, Plus, Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataDialog } from "@/components/data/data-dialog";
import { MatchRow } from "@/components/match/match-row";
import {
  EmptyState,
  LinkButton,
  PageHeader,
  Reveal,
  Segmented,
} from "@/components/shared/primitives";
import {
  FORMATS,
  RESULTS,
  RESULT_META,
  type MatchFormat,
  type MatchResult,
} from "@/lib/domain";
import { chronological } from "@/lib/engine/career";
import { summarise } from "@/lib/stats";
import { useCareer } from "@/lib/store";

const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function MatchesScreen() {
  const { matches, career } = useCareer();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MatchResult | "all">("all");
  const [format, setFormat] = useState<MatchFormat | "all">("all");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return chronological(matches)
      .reverse()
      .filter(
        (match) =>
          (result === "all" || match.result === result) &&
          (format === "all" || match.format === format) &&
          (!needle ||
            match.opponent?.toLowerCase().includes(needle) ||
            match.position.toLowerCase() === needle ||
            match.notes?.toLowerCase().includes(needle)),
      );
  }, [matches, query, result, format]);

  const groups = useMemo(() => {
    const months = new Map<string, typeof filtered>();
    for (const match of filtered) {
      const month = match.date.slice(0, 7);
      months.set(month, [...(months.get(month) ?? []), match]);
    }
    return [...months.entries()];
  }, [filtered]);

  const summary = summarise(filtered);
  const hasFilters = query !== "" || result !== "all" || format !== "all";

  return (
    <Reveal>
      <PageHeader
        eyebrow="Match log"
        title="Fixtures & results"
        description={
          matches.length
            ? `${summary.matches} ${summary.matches === 1 ? "match" : "matches"} · ${summary.goals} goals · ${summary.assists} assists${
                summary.averageRating
                  ? ` · ${summary.averageRating.toFixed(1)} average rating`
                  : ""
              }`
            : undefined
        }
        actions={
          <>
            <DataDialog
              trigger={
                <Button variant="outline" data-icon="inline-start">
                  <ArrowUpDown />
                  Import / export
                </Button>
              }
            />
            <LinkButton
              href="/matches/new"
              variant="cta"
              className="hidden md:inline-flex"
              data-icon="inline-start"
            >
              <Plus strokeWidth={3} />
              Log match
            </LinkButton>
          </>
        }
      />

      {matches.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus />}
          title="No matches yet"
          action={
            <LinkButton href="/matches/new" variant="cta" size="lg">
              Log your first match
            </LinkButton>
          }
        >
          Every career starts with one game. Log it and your card starts to
          develop.
        </EmptyState>
      ) : (
        <>
          <div className="mb-section flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search matches"
                placeholder="Opponent, position or notes"
                value={query}
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="scrollbar-none -mx-gutter flex gap-2 overflow-x-auto px-gutter sm:mx-0 sm:px-0">
              <Segmented
                label="Filter by result"
                size="sm"
                value={result}
                onChange={setResult}
                options={[
                  { value: "all", label: "All" },
                  ...RESULTS.map((value) => ({
                    value,
                    label: RESULT_META[value].label,
                  })),
                ]}
              />
              <Segmented
                label="Filter by format"
                size="sm"
                value={format}
                onChange={setFormat}
                options={[
                  { value: "all", label: "All" },
                  ...FORMATS.map((value) => ({ value, label: value })),
                ]}
              />
            </div>
          </div>

          {groups.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="Nothing matches"
              action={
                hasFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setResult("all");
                      setFormat("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null
              }
            >
              Try a different opponent or fewer filters.
            </EmptyState>
          ) : (
            <div className="space-y-section">
              {groups.map(([month, list]) => (
                <ScrollReveal key={month}>
                  <section>
                    <h2 className="eyebrow mb-3 flex items-center gap-3">
                      {monthLabel.format(new Date(`${month}-01T00:00:00Z`))}
                      <span className="h-px flex-1 bg-border" aria-hidden />
                      <span className="tracking-normal normal-case tabular-nums">
                        {list.length}
                      </span>
                    </h2>
                    <ul className="panel divide-y divide-border overflow-hidden">
                      {list.map((match) => (
                        <MatchRow
                          key={match.id}
                          match={match}
                          xp={career.byMatchId.get(match.id)?.xpGained}
                        />
                      ))}
                    </ul>
                  </section>
                </ScrollReveal>
              ))}
            </div>
          )}
        </>
      )}
    </Reveal>
  );
}
