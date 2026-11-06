"use client";

import { ATTRIBUTES, FORMATS, POSITION_META } from "@/lib/domain";
import type { Career } from "@/lib/engine/career";
import { matchEvidence, xpForNextLevel } from "@/lib/engine/progression";
import { CARD_TIERS, OVR_WEIGHTS, RULES } from "@/lib/engine/rules";
import type { Position } from "@/lib/domain";

const { attributes: A, xp: X } = RULES;

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel min-w-0 p-card">
      <h3 className="heading text-title">{title}</h3>
      <div className="mt-3 space-y-2.5 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs whitespace-nowrap text-foreground">
      {children}
    </code>
  );
}

export function HowItWorks({ career, primary }: { career: Career; primary: Position }) {
  const latest = career.timeline.at(-1);
  const weights = Object.entries(OVR_WEIGHTS[POSITION_META[primary].role])
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid grid-cols-1 gap-block lg:grid-cols-2">
      <Rule title="Attributes follow the evidence">
        <p>
          Every attribute starts at {A.baseline}. A skill rating sets a target of rating × 10, and each match
          closes part of the gap to it.
        </p>
        <Formula>
          change = (rating × 10 − current) × {A.learningRate} × evidence
        </Formula>
        <p>
          One match can add at most {A.maxGainPerMatch} or remove at most {A.maxDropPerMatch}, so a single great
          or terrible game never defines you. Consistency does.
        </p>
      </Rule>

      <Rule title="Nothing is invented">
        <p>
          Skills you don&apos;t rate don&apos;t move. Attributes never decay between matches, because time away
          from logging isn&apos;t evidence of anything. The overall match rating affects XP only, never attributes.
        </p>
        <p>
          Attributes with fewer than {A.lowDataBelow} rated matches are flagged as low data. All ratings are your
          own, so this card shows your assessment of your game, not an external scouting report.
        </p>
      </Rule>

      <Rule title="Evidence depends on the match">
        <p>Longer matches in bigger formats are stronger evidence. Cameos count for at least {RULES.minMinutesShare * 100}% of a full match.</p>
        <Formula>evidence = minutes share × format weight</Formula>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground">
              <th className="py-1 font-semibold">Format</th>
              <th className="py-1 font-semibold">Full match</th>
              <th className="py-1 font-semibold">Weight</th>
              <th className="py-1 font-semibold">G/A value</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {FORMATS.map((format) => (
              <tr key={format} className="border-t border-border">
                <td className="py-1">{format}</td>
                <td className="py-1">{RULES.formats[format].fullMinutes} min</td>
                <td className="py-1">{RULES.formats[format].evidenceWeight}</td>
                <td className="py-1">{RULES.formats[format].contributionWeight * 100}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Rule>

      <Rule title="Goals and assists">
        <p>
          Each goal adds up to {A.contributionBonus} SHO and each assist up to {A.contributionBonus} PAS, scaled by
          format and shrinking as the attribute climbs. At most {A.contributionCap} count per match, so a hat-trick in
          a one-sided 5v5 stays in proportion.
        </p>
        <Formula>
          bonus = count × {A.contributionBonus} × G/A value × (99 − current) ÷ {A.ceiling - A.baseline}
        </Formula>
      </Rule>

      <Rule title="XP from each match">
        <ul className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          <li>Appearance</li>
          <li className="text-right text-foreground tabular-nums">{X.appearance}</li>
          <li>Full match (scaled by minutes)</li>
          <li className="text-right text-foreground tabular-nums">up to {X.fullMatch}</li>
          <li>Each match rating point above 5</li>
          <li className="text-right text-foreground tabular-nums">{X.perRatingPointAboveFive}</li>
          <li>Goal / assist (× G/A value, max {X.contributionCap} each)</li>
          <li className="text-right text-foreground tabular-nums">{X.goal} / {X.assist}</li>
          <li>Win / draw</li>
          <li className="text-right text-foreground tabular-nums">{X.win} / {X.draw}</li>
          <li>Recorded clean sheet (GK or defender)</li>
          <li className="text-right text-foreground tabular-nums">{X.cleanSheet}</li>
        </ul>
        <p className="pt-1">
          Level 2 costs {xpForNextLevel(1)} XP and each level after costs {RULES.levels.stepXp} more. Level {career.level.level + 1} needs{" "}
          {career.level.needed} XP from level {career.level.level}.
        </p>
      </Rule>

      <Rule title="OVR and card tiers">
        <p>
          OVR is a weighted average for your primary position. As a {POSITION_META[primary].name.toLowerCase()}, that&apos;s{" "}
          {weights
            .map(([key, weight]) => `${ATTRIBUTES[key as keyof typeof ATTRIBUTES].code} ${Math.round(weight * 100)}%`)
            .join(", ")}
          .
        </p>
        <ul className="flex flex-wrap gap-2 pt-1 text-xs font-medium">
          {CARD_TIERS.map((tier) => (
            <li key={tier.id} className="rounded bg-accent px-2 py-1 text-foreground">
              {tier.name} {tier.min > 0 ? `${tier.min}+` : `below ${CARD_TIERS[1].min}`}
            </li>
          ))}
        </ul>
      </Rule>

      {latest && latest.changes.length ? (
        <section className="panel p-card lg:col-span-2">
          <h3 className="heading text-title">Worked example: your latest match</h3>
          <p className="mt-3 text-sm text-muted-foreground">
            {latest.match.format}, {latest.match.minutes} minutes: evidence {matchEvidence(latest.match).toFixed(2)}.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {latest.changes.map((change) => (
              <li key={change.key} className="rounded-md bg-surface px-3 py-2 text-sm">
                <span className="font-display text-sm font-bold tracking-wide">{ATTRIBUTES[change.key].code}</span>
                <span className="ml-2 text-muted-foreground">{change.reason}</span>
                <span className="mt-0.5 block tabular-nums">
                  {change.before.toFixed(1)} → {change.after.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
