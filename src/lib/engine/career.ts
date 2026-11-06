import {
  ATTRIBUTE_KEYS,
  POSITIONS,
  type AttributeKey,
  type Attributes,
  type Position,
} from "@/lib/domain";
import type { Match } from "@/lib/schema";
import {
  ACHIEVEMENTS,
  advanceTally,
  emptyTally,
  type AchievementDef,
} from "@/lib/engine/achievements";
import {
  applyMatchToAttributes,
  baselineAttributes,
  levelFromXp,
  overallFor,
  xpForMatch,
  type AttributeChange,
  type XpLine,
} from "@/lib/engine/progression";

/** Only round-number OVR highs reach the timeline, so it stays worth reading. */
const OVR_MILESTONE_STEP = 5;

export interface MatchProgress {
  match: Match;
  xpLines: XpLine[];
  xpGained: number;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  attributes: Attributes;
  changes: AttributeChange[];
  ovrBefore: number;
  ovrAfter: number;
  unlocked: AchievementDef[];
}

export interface AchievementState {
  def: AchievementDef;
  current: number;
  unlockedOn: string | null;
  unlockedBy: string | null;
}

export type Milestone =
  | { kind: "badge"; date: string; matchId: string; badge: AchievementDef }
  | { kind: "level"; date: string; matchId: string; level: number }
  | { kind: "ovr"; date: string; matchId: string; ovr: number };

export interface Career {
  attributes: Attributes;
  /** Rated matches behind each attribute, for the low-data flags. */
  evidence: Record<AttributeKey, number>;
  ovr: number;
  peakOvr: number;
  xp: number;
  level: ReturnType<typeof levelFromXp>;
  timeline: MatchProgress[];
  byMatchId: Map<string, MatchProgress>;
  achievements: AchievementState[];
  milestones: Milestone[];
}

/** Date order, then entry order for matches played on the same day. */
export function chronological(matches: Match[]) {
  return [...matches].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * The whole career is a pure replay of the match log. Nothing derived is ever
 * stored, so editing, deleting or importing a match can't leave stale stats.
 */
export function computeCareer(matches: Match[], primaryPosition: Position): Career {
  const tally = emptyTally();
  const unlockedAt = new Map<string, Match>();
  const timeline: MatchProgress[] = [];
  const milestones: Milestone[] = [];
  const evidence = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 0])) as Record<
    AttributeKey,
    number
  >;

  let attributes = baselineAttributes();
  let xp = 0;
  let ovr = overallFor(attributes, primaryPosition);
  let peakOvr = ovr;

  for (const match of chronological(matches)) {
    const ovrBefore = ovr;
    const xpBefore = xp;
    const levelBefore = levelFromXp(xpBefore).level;

    const applied = applyMatchToAttributes(attributes, match);
    attributes = applied.attributes;
    for (const key of ATTRIBUTE_KEYS) {
      if (match.skillRatings[key] !== undefined) evidence[key] += 1;
    }

    const earned = xpForMatch(match);
    xp += earned.total;
    ovr = overallFor(attributes, primaryPosition);
    const levelAfter = levelFromXp(xp).level;

    advanceTally(tally, match, attributes, ovr);
    const unlocked = ACHIEVEMENTS.filter(
      (def) => !unlockedAt.has(def.id) && def.value(tally) >= def.target,
    );
    for (const def of unlocked) {
      unlockedAt.set(def.id, match);
      milestones.push({ kind: "badge", date: match.date, matchId: match.id, badge: def });
    }
    if (levelAfter > levelBefore) {
      milestones.push({ kind: "level", date: match.date, matchId: match.id, level: levelAfter });
    }
    if (ovr > peakOvr) {
      const threshold = ovr - (ovr % OVR_MILESTONE_STEP);
      if (threshold > peakOvr) {
        milestones.push({ kind: "ovr", date: match.date, matchId: match.id, ovr: threshold });
      }
      peakOvr = ovr;
    }

    timeline.push({
      match,
      xpLines: earned.lines,
      xpGained: earned.total,
      xpBefore,
      xpAfter: xp,
      levelBefore,
      levelAfter,
      attributes,
      changes: applied.changes,
      ovrBefore,
      ovrAfter: ovr,
      unlocked,
    });
  }

  return {
    attributes,
    evidence,
    ovr,
    peakOvr,
    xp,
    level: levelFromXp(xp),
    timeline,
    byMatchId: new Map(timeline.map((entry) => [entry.match.id, entry])),
    achievements: ACHIEVEMENTS.map((def) => ({
      def,
      current: Math.min(def.value(tally), def.target),
      unlockedOn: unlockedAt.get(def.id)?.date ?? null,
      unlockedBy: unlockedAt.get(def.id)?.id ?? null,
    })),
    milestones: milestones.reverse(),
  };
}

/** Locked badges closest to completion, used as the next objectives. */
export function nextObjectives(career: Career, count: number) {
  return career.achievements
    .filter((entry) => !entry.unlockedOn && entry.current > 0)
    .sort((a, b) => b.current / b.def.target - a.current / a.def.target)
    .slice(0, count);
}

export function bestPositions(attributes: Attributes) {
  return POSITIONS.map((position) => ({ position, ovr: overallFor(attributes, position) })).sort(
    (a, b) => b.ovr - a.ovr,
  );
}
