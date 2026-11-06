import type { MatchFormat, PositionRole, AttributeKey } from "@/lib/domain";

/**
 * Every number the progression system uses. The "How it works" section reads
 * from here too, so the published rules cannot drift from the real ones.
 */
export const RULES = {
  attributes: {
    /** Where every attribute starts before any match is logged. */
    baseline: 50,
    /** Share of the gap to the rated level closed by one full 11v11 match. */
    learningRate: 0.1,
    maxGainPerMatch: 2,
    maxDropPerMatch: 1.5,
    /** Goals feed SHO and assists feed PAS, at most this many per match. */
    contributionBonus: 0.3,
    contributionCap: 3,
    /** Below this many rated matches an attribute is flagged as low data. */
    lowDataBelow: 3,
    ceiling: 99,
  },
  formats: {
    "5v5": { fullMinutes: 40, evidenceWeight: 0.8, contributionWeight: 0.5 },
    "7v7": { fullMinutes: 60, evidenceWeight: 0.9, contributionWeight: 0.75 },
    "11v11": { fullMinutes: 90, evidenceWeight: 1, contributionWeight: 1 },
  } satisfies Record<
    MatchFormat,
    { fullMinutes: number; evidenceWeight: number; contributionWeight: number }
  >,
  /** Short cameos still count, but never for less than this share of a match. */
  minMinutesShare: 0.25,
  xp: {
    appearance: 30,
    fullMatch: 40,
    perRatingPointAboveFive: 14,
    goal: 12,
    assist: 10,
    contributionCap: 5,
    win: 25,
    draw: 10,
    cleanSheet: 20,
  },
  levels: {
    /** XP from level 1 to 2. Each later level costs `stepXp` more. */
    firstLevelXp: 200,
    stepXp: 50,
  },
} as const;

/** How much each attribute counts towards OVR in each kind of role. */
export const OVR_WEIGHTS: Record<PositionRole, Record<AttributeKey, number>> = {
  gk: { pac: 0.05, sho: 0, pas: 0.2, dri: 0.05, def: 0.45, phy: 0.25 },
  cb: { pac: 0.15, sho: 0, pas: 0.1, dri: 0.05, def: 0.45, phy: 0.25 },
  fb: { pac: 0.25, sho: 0, pas: 0.15, dri: 0.15, def: 0.3, phy: 0.15 },
  dm: { pac: 0.1, sho: 0.05, pas: 0.25, dri: 0.1, def: 0.3, phy: 0.2 },
  cm: { pac: 0.15, sho: 0.1, pas: 0.3, dri: 0.2, def: 0.1, phy: 0.15 },
  am: { pac: 0.1, sho: 0.15, pas: 0.35, dri: 0.3, def: 0, phy: 0.1 },
  wing: { pac: 0.25, sho: 0.2, pas: 0.15, dri: 0.3, def: 0, phy: 0.1 },
  st: { pac: 0.2, sho: 0.35, pas: 0.1, dri: 0.2, def: 0, phy: 0.15 },
};

export const CARD_TIERS = [
  { id: "academy", name: "Academy", min: 0 },
  { id: "rising", name: "Rising", min: 55 },
  { id: "first-team", name: "First Team", min: 65 },
  { id: "elite", name: "Elite", min: 75 },
  { id: "icon", name: "Icon", min: 85 },
] as const;
export type CardTierId = (typeof CARD_TIERS)[number]["id"];

export const LEVEL_TITLES = [
  { from: 1, title: "Trialist" },
  { from: 5, title: "Squad Player" },
  { from: 10, title: "Regular Starter" },
  { from: 15, title: "Key Player" },
  { from: 20, title: "Club Captain" },
  { from: 30, title: "Club Legend" },
] as const;
