"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Segmented } from "@/components/shared/primitives";
import { Field, FieldError, OverallRating, SkillRatingsInput, Stepper } from "@/components/match/form-controls";
import { PositionPicker } from "@/components/pitch/position-picker";
import { ZonePainter } from "@/components/pitch/zone-painter";
import { useCelebrate } from "@/components/progression/celebration";
import {
  ATTRIBUTES,
  FORMATS,
  POSITION_META,
  RESULTS,
  RESULT_META,
  type MatchFormat,
  type MatchResult,
  type Position,
} from "@/lib/domain";
import { computeCareer } from "@/lib/engine/career";
import { RULES } from "@/lib/engine/rules";
import { LIMITS, matchFieldsSchema, type Match, type MatchFields, type SkillRatings, type ZoneCell } from "@/lib/schema";
import { todayIso } from "@/lib/stats";
import { actions, useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Draft {
  date: string;
  format: MatchFormat;
  position: Position;
  minutes: string;
  goals: number;
  assists: number;
  result: MatchResult;
  opponent: string;
  teamScore: string;
  opponentScore: string;
  rating: number;
  skillRatings: SkillRatings;
  zones: ZoneCell[];
  notes: string;
}

const optionalNumber = (value: string) => (value === "" ? undefined : Number(value));
const optionalText = (value: string) => (value.trim() === "" ? undefined : value.trim());

function toFields(draft: Draft): MatchFields {
  return {
    date: draft.date,
    format: draft.format,
    position: draft.position,
    minutes: Number(draft.minutes),
    goals: draft.goals,
    assists: draft.assists,
    result: draft.result,
    opponent: optionalText(draft.opponent),
    teamScore: optionalNumber(draft.teamScore),
    opponentScore: optionalNumber(draft.opponentScore),
    rating: draft.rating,
    skillRatings: draft.skillRatings,
    zones: draft.zones,
    notes: optionalText(draft.notes),
  };
}

function fromMatch(match: Match): Draft {
  return {
    date: match.date,
    format: match.format,
    position: match.position,
    minutes: String(match.minutes),
    goals: match.goals,
    assists: match.assists,
    result: match.result,
    opponent: match.opponent ?? "",
    teamScore: match.teamScore === undefined ? "" : String(match.teamScore),
    opponentScore: match.opponentScore === undefined ? "" : String(match.opponentScore),
    rating: match.rating,
    skillRatings: match.skillRatings,
    zones: match.zones,
    notes: match.notes ?? "",
  };
}

function resultFromScore(team: string, opponent: string): MatchResult | null {
  if (team === "" || opponent === "") return null;
  const difference = Number(team) - Number(opponent);
  return difference > 0 ? "win" : difference < 0 ? "loss" : "draw";
}

function Section({ index, title, aside, children }: { index: string; title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="panel p-card">
      <header className="mb-6 flex items-baseline gap-3 border-b border-border pb-4">
        <span className="stat text-sm font-bold text-primary">{index}</span>
        <h2 className="heading text-title">{title}</h2>
        {aside ? <span className="ml-auto text-xs text-muted-foreground">{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function MatchForm({ editing }: { editing?: Match }) {
  const router = useRouter();
  const celebrate = useCelebrate();
  const { matches, profile, career } = useCareer();

  function blankDraft(): Draft {
    const latest = career.timeline.at(-1)?.match;
    const format = latest?.format ?? "11v11";
    return {
      date: todayIso(),
      format,
      position: latest?.position ?? profile.positions[0],
      minutes: String(RULES.formats[format].fullMinutes),
      goals: 0,
      assists: 0,
      result: "win",
      opponent: "",
      teamScore: "",
      opponentScore: "",
      rating: 6.5,
      skillRatings: {},
      zones: [],
      notes: "",
    };
  }

  const [draft, setDraft] = useState<Draft>(() => (editing ? fromMatch(editing) : blankDraft()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setScore(key: "teamScore" | "opponentScore", value: string) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      return { ...next, result: resultFromScore(next.teamScore, next.opponentScore) ?? next.result };
    });
  }

  function setFormat(format: MatchFormat) {
    setDraft((current) => {
      const wasFull = Number(current.minutes) === RULES.formats[current.format].fullMinutes;
      return {
        ...current,
        format,
        minutes: wasFull ? String(RULES.formats[format].fullMinutes) : current.minutes,
      };
    });
  }

  function validate() {
    const parsed = matchFieldsSchema.safeParse(toFields(draft));
    const issues: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        issues[key] ??= issue.message;
      }
    }
    if (draft.date > todayIso()) issues.date = "This match hasn't happened yet";
    return { parsed, issues };
  }

  const preview = useMemo(() => {
    const parsed = matchFieldsSchema.safeParse(toFields(draft));
    if (!parsed.success) return null;
    const id = editing?.id ?? "draft";
    const candidate: Match = { ...parsed.data, id, createdAt: editing?.createdAt ?? "9999" };
    const list = editing
      ? matches.map((match) => (match.id === id ? candidate : match))
      : [...matches, candidate];
    return computeCareer(list, profile.positions[0]).byMatchId.get(id) ?? null;
  }, [draft, editing, matches, profile.positions]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitted(true);
    const { parsed, issues } = validate();
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) {
      toast.error("Check the highlighted fields", { description: Object.values(issues)[0] });
      requestAnimationFrame(() => {
        form.querySelector('[role="alert"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    setSubmitted(false);
    toast.dismiss();
    if (editing) {
      actions.updateMatch(editing.id, parsed.data);
      toast.success("Match updated", { description: "Your career has been recalculated." });
      router.push(`/matches/${editing.id}`);
    } else {
      const match = actions.addMatch(parsed.data);
      // Visited routes stay mounted, so clear the form for the next match.
      setDraft(blankDraft());
      celebrate(match.id);
      router.push(`/matches/${match.id}`);
    }
  }

  const liveErrors = submitted ? validate().issues : errors;
  const saveLabel = editing ? "Save changes" : "Save match";

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 items-start gap-block lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      <div className="min-w-0 space-y-block">
        <Section index="01" title="Fixture">
          <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
            <Field label="Date" htmlFor="date" error={liveErrors.date}>
              <Input
                id="date"
                type="date"
                value={draft.date}
                max={todayIso()}
                aria-invalid={Boolean(liveErrors.date)}
                onChange={(event) => set("date", event.target.value)}
              />
            </Field>
            <Field label="Opponent" htmlFor="opponent" hint="Optional" error={liveErrors.opponent}>
              <Input
                id="opponent"
                value={draft.opponent}
                maxLength={LIMITS.opponent}
                placeholder="e.g. Sunday league rivals"
                onChange={(event) => set("opponent", event.target.value)}
              />
            </Field>
            <Field label="Format">
              <Segmented
                label="Format"
                value={draft.format}
                onChange={setFormat}
                options={FORMATS.map((format) => ({ value: format, label: format }))}
                className="flex"
              />
            </Field>
            <Field label="Final score" hint="Optional" error={liveErrors.teamScore ?? liveErrors.opponentScore}>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Your team's score"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LIMITS.score}
                  value={draft.teamScore}
                  placeholder="Us"
                  className="text-center"
                  onChange={(event) => setScore("teamScore", event.target.value)}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  aria-label="Opponent's score"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={LIMITS.score}
                  value={draft.opponentScore}
                  placeholder="Them"
                  className="text-center"
                  onChange={(event) => setScore("opponentScore", event.target.value)}
                />
              </div>
            </Field>
            <Field label="Result" error={liveErrors.result} className="sm:col-span-2">
              <Segmented
                label="Result"
                value={draft.result}
                onChange={(value) => set("result", value)}
                options={RESULTS.map((result) => ({ value: result, label: RESULT_META[result].label }))}
                className="flex"
              />
            </Field>
          </div>
        </Section>

        <Section index="02" title="Your game">
          <div className="grid gap-x-4 gap-y-6 sm:grid-cols-3">
            <Field label="Minutes" htmlFor="minutes" error={liveErrors.minutes} hint={`Full: ${RULES.formats[draft.format].fullMinutes}`}>
              <Input
                id="minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMITS.minutes}
                value={draft.minutes}
                aria-invalid={Boolean(liveErrors.minutes)}
                className="stat h-[3.375rem] text-center text-stat md:text-stat"
                onChange={(event) => set("minutes", event.target.value)}
              />
            </Field>
            <Field label="Goals" error={liveErrors.goals}>
              <Stepper label="Goals" value={draft.goals} onChange={(value) => set("goals", value)} max={LIMITS.perMatchStat} />
            </Field>
            <Field label="Assists">
              <Stepper label="Assists" value={draft.assists} onChange={(value) => set("assists", value)} max={LIMITS.perMatchStat} />
            </Field>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="eyebrow text-foreground/85">Position played</p>
              <p className="text-sm font-semibold">{POSITION_META[draft.position].name}</p>
            </div>
            <div className="mx-auto max-w-[min(100%,46vh)] sm:max-w-none">
              <PositionPicker
                label="Pick the position you played"
                value={[draft.position]}
                onChange={(positions) => set("position", positions[0])}
              />
            </div>
          </div>
        </Section>

        <Section index="03" title="Performance">
          <OverallRating value={draft.rating} onChange={(value) => set("rating", value)} />
          <FieldError message={liveErrors.rating} />
          <div className="mt-5">
            <p className="eyebrow text-foreground/85">Skill ratings</p>
            <p className="mt-1.5 mb-3 text-xs text-muted-foreground">
              Rate only what you can judge honestly. Ratings start at your current level, and skills you skip stay exactly as they are.
            </p>
            <SkillRatingsInput
              value={draft.skillRatings}
              onChange={(value) => set("skillRatings", value)}
              current={career.attributes}
            />
          </div>
        </Section>

        <Section index="04" title="Pitch map" aside="Optional">
          <p className="mb-4 text-sm text-muted-foreground">
            Drag across the areas you covered. Every map feeds your season heatmap.
          </p>
          <ZonePainter value={draft.zones} onChange={(value) => set("zones", value)} />
        </Section>

        <Section index="05" title="Notes" aside="Optional">
          <Textarea
            aria-label="Match notes"
            value={draft.notes}
            maxLength={LIMITS.notes}
            rows={4}
            placeholder="What worked, what didn't, what to remember for next time"
            onChange={(event) => set("notes", event.target.value)}
          />
          <p className="mt-1.5 text-right text-xs text-muted-foreground tabular-nums">
            {draft.notes.length} / {LIMITS.notes}
          </p>
        </Section>
      </div>

      <aside className="hidden lg:sticky lg:top-24 lg:block">
        <div className="panel p-card">
          <h2 className="eyebrow">Projected reward</h2>
          {preview ? (
            <>
              <p className="stat mt-3 text-stat-xl text-primary">+{preview.xpGained}</p>
              <p className="eyebrow mt-1.5">XP</p>
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
                {preview.xpLines.map((line) => (
                  <li key={line.label} className="flex justify-between gap-3 text-muted-foreground">
                    <span>{line.label}</span>
                    <span className="font-medium text-foreground tabular-nums">+{line.amount}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="eyebrow mb-2">Attribute changes</h3>
                {preview.changes.length ? (
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {preview.changes.map((change) => (
                      <li key={change.key} className="flex justify-between text-sm">
                        <span className="font-medium text-muted-foreground">{ATTRIBUTES[change.key].code}</span>
                        <span className={cn("font-semibold tabular-nums", change.delta >= 0 ? "text-positive" : "text-loss")}>
                          {change.delta >= 0 ? "+" : "−"}
                          {Math.abs(change.delta).toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Rate a skill to see it develop.</p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Finish the required fields to preview XP and attribute changes.
            </p>
          )}
          <Button type="submit" variant="cta" size="lg" className="mt-5 w-full" data-icon="inline-start">
            <Save />
            {saveLabel}
          </Button>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Projected</p>
            <p className="stat mt-1 text-stat text-primary">
              {preview ? `+${preview.xpGained} XP` : "Incomplete"}
            </p>
          </div>
          <Button type="submit" variant="cta" size="lg" data-icon="inline-start">
            <Save />
            {saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
