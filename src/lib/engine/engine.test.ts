import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@/lib/engine/achievements";
import { computeCareer } from "@/lib/engine/career";
import {
  applyMatchToAttributes,
  baselineAttributes,
  levelFromXp,
  overallFor,
  xpForMatch,
  xpForNextLevel,
} from "@/lib/engine/progression";
import { RULES, OVR_WEIGHTS } from "@/lib/engine/rules";
import { aggregateZones, densityField, zoneShares } from "@/lib/heatmap";
import { buildSampleMatches } from "@/lib/sample-data";
import { careerFileSchema, matchFieldsSchema, matchSchema, type Match } from "@/lib/schema";
import { inScope, rollingAverage, seasonOf, summarise } from "@/lib/stats";

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    createdAt: "2026-01-01T10:00:00.000Z",
    date: "2026-01-01",
    format: "11v11",
    position: "ST",
    minutes: 90,
    goals: 0,
    assists: 0,
    result: "draw",
    rating: 6,
    skillRatings: {},
    zones: [],
    ...overrides,
  };
}

describe("attributes", () => {
  it("leaves unrated attributes untouched", () => {
    const { attributes, changes } = applyMatchToAttributes(baselineAttributes(), match({ rating: 10 }));
    expect(attributes).toEqual(baselineAttributes());
    expect(changes).toEqual([]);
  });

  it("moves a rated attribute a fraction of the way to the rated level", () => {
    const { attributes } = applyMatchToAttributes(baselineAttributes(), match({ skillRatings: { pac: 6.5 } }));
    expect(attributes.pac).toBeCloseTo(50 + (65 - 50) * RULES.attributes.learningRate);
    expect(attributes.sho).toBe(50);
  });

  it("drops after a poor rating, but only by the cap", () => {
    const start = { ...baselineAttributes(), def: 90 };
    const { attributes } = applyMatchToAttributes(start, match({ skillRatings: { def: 1 } }));
    expect(attributes.def).toBeCloseTo(90 - RULES.attributes.maxDropPerMatch);
  });

  it("weighs small formats and short cameos as weaker evidence", () => {
    const rate = (m: Match) => applyMatchToAttributes(baselineAttributes(), m).attributes.pac - 50;
    const full = rate(match({ skillRatings: { pac: 6.5 } }));
    const fiveASide = rate(match({ format: "5v5", minutes: 40, skillRatings: { pac: 6.5 } }));
    const cameo = rate(match({ minutes: 10, skillRatings: { pac: 6.5 } }));
    expect(fiveASide).toBeLessThan(full);
    expect(cameo).toBeCloseTo(full * RULES.minMinutesShare);
  });

  it("gives goals a small shooting bonus without a rating", () => {
    const { attributes, changes } = applyMatchToAttributes(baselineAttributes(), match({ goals: 2 }));
    expect(attributes.sho).toBeCloseTo(50 + 2 * RULES.attributes.contributionBonus);
    expect(changes.map((change) => change.key)).toEqual(["sho"]);
  });

  it("caps counted contributions", () => {
    const three = applyMatchToAttributes(baselineAttributes(), match({ goals: 3 })).attributes.sho;
    const ten = applyMatchToAttributes(baselineAttributes(), match({ goals: 10 })).attributes.sho;
    expect(ten).toBe(three);
  });

  it("caps the gain from a single match", () => {
    const { attributes } = applyMatchToAttributes(baselineAttributes(), match({ skillRatings: { pac: 10 } }));
    expect(attributes.pac).toBe(50 + RULES.attributes.maxGainPerMatch);
  });

  it("never exceeds the ceiling", () => {
    const start = { ...baselineAttributes(), sho: 98.9 };
    const { attributes } = applyMatchToAttributes(start, match({ goals: 5, skillRatings: { sho: 10 } }));
    expect(attributes.sho).toBeLessThanOrEqual(RULES.attributes.ceiling);
  });

  it("keeps every OVR weighting summing to one", () => {
    for (const weights of Object.values(OVR_WEIGHTS)) {
      const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1);
    }
  });

  it("starts every position at the baseline OVR", () => {
    expect(overallFor(baselineAttributes(), "GK")).toBe(50);
    expect(overallFor(baselineAttributes(), "ST")).toBe(50);
  });
});

describe("xp and levels", () => {
  it("itemises every source of XP and adds up", () => {
    const { lines, total } = xpForMatch(match({ goals: 1, assists: 1, result: "win", rating: 8 }));
    expect(total).toBe(lines.reduce((sum, line) => sum + line.amount, 0));
    expect(total).toBe(30 + 40 + 42 + 12 + 10 + 25);
  });

  it("gives no rating XP at or below 5", () => {
    expect(xpForMatch(match({ rating: 5 })).lines.some((line) => line.label.startsWith("Match rating"))).toBe(false);
  });

  it("only awards clean sheets to defenders with a recorded score", () => {
    const label = (m: Match) => xpForMatch(m).lines.some((line) => line.label === "Clean sheet");
    expect(label(match({ position: "CB", teamScore: 1, opponentScore: 0, result: "win" }))).toBe(true);
    expect(label(match({ position: "CB" }))).toBe(false);
    expect(label(match({ position: "ST", teamScore: 1, opponentScore: 0, result: "win" }))).toBe(false);
  });

  it("levels up at the published thresholds", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1) - 1).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1)).level).toBe(2);
    expect(levelFromXp(xpForNextLevel(1) + xpForNextLevel(2)).into).toBe(0);
  });
});

describe("career replay", () => {
  const matches = buildSampleMatches(new Date("2026-11-02T12:00:00Z"));
  const career = computeCareer(matches, "ST");

  it("is order-independent", () => {
    expect(computeCareer([...matches].reverse(), "ST").attributes).toEqual(career.attributes);
  });

  it("forgets a deleted match entirely", () => {
    const without = matches.filter((entry) => entry.id !== "demo-09");
    const rebuilt = computeCareer(without, "ST");
    expect(rebuilt.xp).toBe(career.xp - career.byMatchId.get("demo-09")!.xpGained);
    const hatTrick = rebuilt.achievements.find((entry) => entry.def.id === "hat-trick");
    expect(hatTrick?.unlockedOn).toBeNull();
  });

  it("recalculates downstream matches after a back-dated edit", () => {
    const edited = matches.map((entry) =>
      entry.id === "demo-01" ? { ...entry, skillRatings: { pac: 10 } } : entry,
    );
    expect(computeCareer(edited, "ST").attributes.pac).not.toBe(career.attributes.pac);
  });

  it("unlocks badges at the match that earned them", () => {
    const hatTrick = career.achievements.find((entry) => entry.def.id === "hat-trick");
    expect(hatTrick?.unlockedBy).toBe("demo-09");
  });

  it("produces a believable demo player", () => {
    expect(career.ovr).toBeGreaterThan(60);
    expect(career.ovr).toBeLessThan(80);
    expect(career.evidence.def).toBeLessThan(career.evidence.sho);
  });

  it("only reports round-number OVR milestones", () => {
    const ovrMilestones = career.milestones.flatMap((entry) => (entry.kind === "ovr" ? [entry.ovr] : []));
    expect(ovrMilestones.reverse()).toEqual([55, 60, 65]);
  });

  it("gives every achievement a positive target", () => {
    expect(new Set(ACHIEVEMENTS.map((def) => def.id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.every((def) => def.target > 0)).toBe(true);
  });

  it("handles an empty career", () => {
    const empty = computeCareer([], "CM");
    expect(empty.ovr).toBe(50);
    expect(empty.level.level).toBe(1);
    expect(empty.timeline).toEqual([]);
  });
});

describe("validation", () => {
  it("accepts every sample match", () => {
    for (const entry of buildSampleMatches(new Date("2026-11-02T12:00:00Z"))) {
      expect(matchSchema.safeParse(entry).success, entry.id).toBe(true);
    }
  });

  it("rejects a score that disagrees with the result", () => {
    const parsed = matchFieldsSchema.safeParse(match({ result: "win", teamScore: 1, opponentScore: 2 }));
    expect(parsed.success).toBe(false);
  });

  it("rejects more goal involvements than team goals", () => {
    const parsed = matchFieldsSchema.safeParse(
      match({ result: "win", teamScore: 2, opponentScore: 1, goals: 2, assists: 1 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects one-sided scores and off-step ratings", () => {
    expect(matchFieldsSchema.safeParse(match({ teamScore: 1 })).success).toBe(false);
    expect(matchFieldsSchema.safeParse(match({ rating: 7.3 })).success).toBe(false);
  });

  it("rejects files from other apps", () => {
    expect(careerFileSchema.safeParse({ app: "other", schemaVersion: 1, matches: [] }).success).toBe(false);
  });
});

describe("stats and heatmap", () => {
  it("splits seasons at August", () => {
    expect(seasonOf("2026-07-31")).toBe("2025/26");
    expect(seasonOf("2026-08-01")).toBe("2026/27");
  });

  it("summarises only what is in scope", () => {
    const matches = [match({ date: "2026-08-10", result: "win" }), match({ id: "m2", date: "2026-03-10", result: "loss" })];
    expect(summarise(inScope(matches, "2026/27")).winRate).toBe(1);
    expect(summarise([]).winRate).toBeNull();
  });

  it("waits for a full window before averaging", () => {
    expect(rollingAverage([1, 2, 3], 2)).toEqual([null, 1.5, 2.5]);
  });

  it("aggregates zones and reports shares that sum to one", () => {
    const grid = aggregateZones([
      { zones: [{ col: 11, row: 0, intensity: 3 }] },
      { zones: [{ col: 11, row: 0, intensity: 1 }, { col: 0, row: 7, intensity: 2 }] },
    ]);
    const shares = zoneShares(grid);
    expect(shares.total).toBe(6);
    expect(shares.thirds.reduce((sum, third) => sum + third.share, 0)).toBeCloseTo(1);
    expect(shares.hottest).toBe("Attacking third, left channel");
  });

  it("normalises density to one and stays empty without data", () => {
    const empty = densityField(aggregateZones([]), 24, 16);
    expect(Math.max(...empty)).toBe(0);
    const field = densityField(aggregateZones([{ zones: [{ col: 5, row: 4, intensity: 2 }] }]), 24, 16);
    expect(Math.max(...field)).toBeCloseTo(1);
  });
});
