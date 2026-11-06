"use client";

import type { ReactNode } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ATTRIBUTES, ATTRIBUTE_KEYS, type AttributeKey, type Attributes } from "@/lib/domain";
import { ratingBand } from "@/lib/engine/progression";
import type { SkillRatings } from "@/lib/schema";
import { cn } from "@/lib/utils";

export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="eyebrow text-foreground/85">
          {label}
        </label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      <FieldError message={error} />
    </div>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
}) {
  const buttonClass =
    "grid size-11 shrink-0 place-items-center rounded-md bg-accent text-foreground transition active:scale-95 disabled:opacity-35 hover:bg-foreground hover:text-background disabled:hover:bg-accent disabled:hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-1">
      <button
        type="button"
        aria-label={`Remove one from ${label}`}
        disabled={value <= 0}
        className={buttonClass}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus className="size-4" strokeWidth={3} />
      </button>
      <output aria-label={label} className="stat min-w-10 text-center text-stat">
        {value}
      </output>
      <button
        type="button"
        aria-label={`Add one to ${label}`}
        disabled={value >= max}
        className={buttonClass}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus className="size-4" strokeWidth={3} />
      </button>
    </div>
  );
}

function RatingSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Slider
      aria-label={label}
      min={1}
      max={10}
      step={0.5}
      value={[value]}
      onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : (next as number))}
    />
  );
}

export function OverallRating({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-card">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-foreground/85">Match rating</p>
          <p className="mt-1.5 text-sm font-semibold">{ratingBand(value)}</p>
        </div>
        <p className="stat text-stat-xl text-primary">{value.toFixed(1)}</p>
      </div>
      <div className="mt-4">
        <RatingSlider label="Match rating" value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  value,
  neutral,
  onChange,
}: {
  skill: AttributeKey;
  value: number | undefined;
  neutral: number;
  onChange: (value: number | undefined) => void;
}) {
  const meta = ATTRIBUTES[skill];
  const rated = value !== undefined;
  return (
    <div
      className={cn(
        "flex min-h-16 items-center gap-4 rounded-lg border px-3 py-2 transition-colors sm:px-4",
        rated ? "border-foreground/20 bg-accent/50" : "border-border",
      )}
    >
      <div className="w-[4.6rem] shrink-0 sm:w-40">
        <p className="font-display text-sm leading-none font-bold tracking-wide">{meta.code}</p>
        <p className="mt-1 hidden text-xs leading-tight text-muted-foreground sm:block">{meta.prompt}</p>
        <p className="mt-1 text-xs leading-tight text-muted-foreground sm:hidden">{meta.name}</p>
      </div>
      {rated ? (
        <>
          <div className="flex-1">
            <RatingSlider label={`${meta.name} rating`} value={value} onChange={onChange} />
          </div>
          <span className="stat w-10 text-right text-stat-sm text-primary">
            {value.toFixed(1)}
          </span>
          <button
            type="button"
            aria-label={`Clear ${meta.name} rating`}
            className="grid size-9 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            onClick={() => onChange(undefined)}
          >
            <X className="size-4" />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ml-auto h-9 rounded-md border border-border px-3.5 font-display text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground"
          onClick={() => onChange(neutral)}
          aria-label={`Rate ${meta.name}`}
        >
          Rate
        </button>
      )}
    </div>
  );
}

/** The rating that matches a skill's current level, so opening one changes nothing. */
function neutralRating(attribute: number) {
  return Math.min(10, Math.max(1, Math.round(attribute / 5) / 2));
}

export function SkillRatingsInput({
  value,
  onChange,
  current,
}: {
  value: SkillRatings;
  onChange: (value: SkillRatings) => void;
  current: Attributes;
}) {
  return (
    <div className="grid gap-2 xl:grid-cols-2">
      {ATTRIBUTE_KEYS.map((key) => (
        <SkillRow
          key={key}
          skill={key}
          value={value[key]}
          neutral={neutralRating(current[key])}
          onChange={(rating) => {
            const next = { ...value };
            if (rating === undefined) delete next[key];
            else next[key] = rating;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}
