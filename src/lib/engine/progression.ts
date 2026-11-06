import {
  ATTRIBUTE_KEYS,
  POSITION_META,
  type AttributeKey,
  type Attributes,
  type Position,
} from "@/lib/domain";
import type { MatchFields } from "@/lib/schema";
import { CARD_TIERS, LEVEL_TITLES, OVR_WEIGHTS, RULES } from "@/lib/engine/rules";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function baselineAttributes(): Attributes {
  const { baseline } = RULES.attributes;
  return { pac: baseline, sho: baseline, pas: baseline, dri: baseline, def: baseline, phy: baseline };
}

/** Share of a full match played, floored so cameos still count a little. */
export function minutesShare(match: Pick<MatchFields, "format" | "minutes">) {
  const { fullMinutes } = RULES.formats[match.format];
  return clamp(match.minutes / fullMinutes, RULES.minMinutesShare, 1);
}

/** How much evidence this match provides, from 0.2 up to 1. */
export function matchEvidence(match: Pick<MatchFields, "format" | "minutes">) {
  return minutesShare(match) * RULES.formats[match.format].evidenceWeight;
}

export interface AttributeChange {
  key: AttributeKey;
  before: number;
  after: number;
  delta: number;
  reason: string;
}

function contributionFor(key: AttributeKey, match: MatchFields) {
  if (key === "sho") return { count: match.goals, noun: "goal" };
  if (key === "pas") return { count: match.assists, noun: "assist" };
  return { count: 0, noun: "" };
}

/**
 * Moves each attribute towards what the match actually showed. Attributes with
 * no rating and no linked stat stay exactly where they are: nothing is inferred
 * from the overall rating or from absence.
 */
export function applyMatchToAttributes(attributes: Attributes, match: MatchFields) {
  const { learningRate, maxGainPerMatch, maxDropPerMatch, contributionBonus, contributionCap, ceiling } =
    RULES.attributes;
  const evidence = matchEvidence(match);
  const next = { ...attributes };
  const changes: AttributeChange[] = [];

  for (const key of ATTRIBUTE_KEYS) {
    const before = attributes[key];
    const rated = match.skillRatings[key];
    const { count, noun } = contributionFor(key, match);
    let delta = 0;
    const reasons: string[] = [];

    if (rated !== undefined) {
      const target = rated * 10;
      delta += clamp((target - before) * learningRate * evidence, -maxDropPerMatch, maxGainPerMatch);
      reasons.push(`rated ${rated}`);
    }
    if (count > 0) {
      // The bonus halves as the attribute climbs, so stats alone can't run away.
      const headroom = clamp((ceiling - before) / (ceiling - RULES.attributes.baseline), 0, 1);
      delta +=
        Math.min(count, contributionCap) *
        contributionBonus *
        RULES.formats[match.format].contributionWeight *
        headroom;
      reasons.push(`${count} ${noun}${count === 1 ? "" : "s"}`);
    }
    if (reasons.length === 0) continue;

    const after = clamp(before + delta, 1, ceiling);
    next[key] = after;
    changes.push({ key, before, after, delta: after - before, reason: reasons.join(" + ") });
  }

  return { attributes: next, changes };
}

export function overallFor(attributes: Attributes, position: Position) {
  const weights = OVR_WEIGHTS[POSITION_META[position].role];
  const total = ATTRIBUTE_KEYS.reduce((sum, key) => sum + attributes[key] * weights[key], 0);
  return Math.round(total);
}

export function cardTierFor(ovr: number) {
  return [...CARD_TIERS].reverse().find((tier) => ovr >= tier.min) ?? CARD_TIERS[0];
}

export interface XpLine {
  label: string;
  amount: number;
}

export function isCleanSheet(match: MatchFields) {
  const defensive = ["GK", "DEF"].includes(POSITION_META[match.position].line);
  return defensive && match.opponentScore === 0;
}

/** Itemised XP for one match. Clean sheets need a recorded score. */
export function xpForMatch(match: MatchFields): { lines: XpLine[]; total: number } {
  const { xp } = RULES;
  const weight = RULES.formats[match.format].contributionWeight;
  const lines: XpLine[] = [
    { label: "Appearance", amount: xp.appearance },
    {
      label: `Minutes played (${Math.round(minutesShare(match) * 100)}% of a full match)`,
      amount: Math.round(xp.fullMatch * minutesShare(match)),
    },
  ];
  const aboveFive = Math.max(0, match.rating - 5);
  if (aboveFive > 0) {
    lines.push({
      label: `Match rating ${match.rating.toFixed(1)}`,
      amount: Math.round(aboveFive * xp.perRatingPointAboveFive),
    });
  }
  const goals = Math.min(match.goals, xp.contributionCap);
  if (goals > 0) {
    lines.push({
      label: `${goals === 1 ? "Goal" : `${goals} goals`} (${match.format})`,
      amount: Math.round(goals * xp.goal * weight),
    });
  }
  const assists = Math.min(match.assists, xp.contributionCap);
  if (assists > 0) {
    lines.push({
      label: `${assists === 1 ? "Assist" : `${assists} assists`} (${match.format})`,
      amount: Math.round(assists * xp.assist * weight),
    });
  }
  if (match.result === "win") lines.push({ label: "Win", amount: xp.win });
  if (match.result === "draw") lines.push({ label: "Draw", amount: xp.draw });
  if (isCleanSheet(match)) lines.push({ label: "Clean sheet", amount: xp.cleanSheet });

  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) };
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForNextLevel(level: number) {
  return RULES.levels.firstLevelXp + RULES.levels.stepXp * (level - 1);
}

export function levelFromXp(totalXp: number) {
  let level = 1;
  let floor = 0;
  while (totalXp >= floor + xpForNextLevel(level)) {
    floor += xpForNextLevel(level);
    level += 1;
  }
  const needed = xpForNextLevel(level);
  const into = totalXp - floor;
  return { level, into, needed, progress: into / needed };
}

export function levelTitle(level: number) {
  return [...LEVEL_TITLES].reverse().find((entry) => level >= entry.from)?.title ?? LEVEL_TITLES[0].title;
}

export function ratingBand(rating: number) {
  if (rating >= 9) return "World class";
  if (rating >= 8) return "Excellent";
  if (rating >= 7) return "Very good";
  if (rating >= 6) return "Solid";
  if (rating >= 5) return "Average";
  if (rating >= 4) return "Below par";
  return "Tough day";
}

