import {
  ZONE_COLS,
  ZONE_ROWS,
  type MatchFormat,
  type MatchResult,
  type Position,
} from "@/lib/domain";
import type { Match, PlayerProfile, SkillRatings, ZoneCell } from "@/lib/schema";

/**
 * Fictional demo career. Every record carries `isSample` so the UI can label
 * it and remove it cleanly when a real career starts.
 */
export const SAMPLE_PROFILE: PlayerProfile = {
  name: "Kai Mercer",
  positions: ["ST", "LW", "CAM"],
  nationality: "ENG",
  shirtNumber: 9,
  photo: null,
  isSample: true,
};

interface SampleRow {
  daysAgo: number;
  format: MatchFormat;
  position: Position;
  minutes: number;
  goals: number;
  assists: number;
  result: MatchResult;
  score: [number, number];
  opponent: string;
  rating: number;
  skills: SkillRatings;
  mapped?: boolean;
  notes?: string;
}

const ROWS: SampleRow[] = [
  { daysAgo: 236, format: "11v11", position: "ST", minutes: 62, goals: 0, assists: 0, result: "loss", score: [0, 2], opponent: "Eastfield Athletic", rating: 5, skills: { sho: 5, pac: 6, phy: 5 }, notes: "First game back after a long break. Blowing by half time." },
  { daysAgo: 229, format: "5v5", position: "ST", minutes: 40, goals: 1, assists: 1, result: "win", score: [6, 4], opponent: "Thursday Night FC", rating: 6.5, skills: { sho: 6.5, dri: 6, pas: 6 } },
  { daysAgo: 222, format: "11v11", position: "ST", minutes: 75, goals: 1, assists: 0, result: "draw", score: [1, 1], opponent: "Millbrook Town", rating: 6, skills: { sho: 6.5, pac: 6, phy: 5.5 } },
  { daysAgo: 215, format: "5v5", position: "LW", minutes: 40, goals: 0, assists: 2, result: "win", score: [5, 3], opponent: "Goalhangers", rating: 6.5, skills: { dri: 6.5, pas: 6.5 }, mapped: false },
  { daysAgo: 208, format: "11v11", position: "ST", minutes: 90, goals: 2, assists: 0, result: "win", score: [3, 1], opponent: "St Luke's Old Boys", rating: 7.5, skills: { sho: 7.5, pac: 6.5, phy: 6, dri: 6 }, notes: "First full 90 of the year. Both goals from balls over the top." },
  { daysAgo: 194, format: "7v7", position: "ST", minutes: 60, goals: 1, assists: 1, result: "win", score: [4, 2], opponent: "Canal Street Rangers", rating: 7, skills: { sho: 6.5, pas: 7, dri: 6.5 } },
  { daysAgo: 187, format: "11v11", position: "ST", minutes: 68, goals: 0, assists: 0, result: "loss", score: [0, 3], opponent: "Northgate United", rating: 4.5, skills: { sho: 4, phy: 5, pac: 5.5 }, notes: "Barely saw the ball. Dropped too deep and got frustrated." },
  { daysAgo: 173, format: "5v5", position: "CAM", minutes: 40, goals: 1, assists: 2, result: "win", score: [7, 5], opponent: "Thursday Night FC", rating: 7.5, skills: { pas: 7.5, dri: 7, sho: 6.5 } },
  { daysAgo: 159, format: "5v5", position: "ST", minutes: 40, goals: 3, assists: 0, result: "win", score: [6, 2], opponent: "Astro Boys", rating: 8.5, skills: { sho: 8.5, dri: 7, pac: 7 }, notes: "Hat-trick. Everything I hit went in." },
  { daysAgo: 138, format: "7v7", position: "LW", minutes: 55, goals: 1, assists: 1, result: "draw", score: [3, 3], opponent: "Harbour Lane", rating: 7, skills: { pac: 7, dri: 7, def: 5.5 } },
  { daysAgo: 124, format: "5v5", position: "ST", minutes: 40, goals: 1, assists: 0, result: "loss", score: [3, 6], opponent: "Goalhangers", rating: 6, skills: { sho: 6, phy: 6 }, mapped: false },
  { daysAgo: 89, format: "11v11", position: "ST", minutes: 70, goals: 0, assists: 1, result: "win", score: [2, 0], opponent: "Eastfield Athletic", rating: 6.5, skills: { pas: 6.5, pac: 6.5, phy: 6.5 }, notes: "Pre-season. Worked on pressing from the front." },
  { daysAgo: 75, format: "11v11", position: "ST", minutes: 90, goals: 1, assists: 1, result: "win", score: [3, 2], opponent: "Millbrook Town", rating: 7.5, skills: { sho: 7.5, pas: 7, pac: 7, phy: 7, def: 6 } },
  { daysAgo: 68, format: "5v5", position: "ST", minutes: 40, goals: 2, assists: 1, result: "win", score: [8, 4], opponent: "Thursday Night FC", rating: 8, skills: { sho: 8, dri: 7.5, pas: 7 } },
  { daysAgo: 61, format: "11v11", position: "ST", minutes: 90, goals: 2, assists: 0, result: "win", score: [2, 1], opponent: "Northgate United", rating: 8, skills: { sho: 8, pac: 7, phy: 7 }, notes: "Late winner at the far post. Best game for the club so far." },
  { daysAgo: 54, format: "7v7", position: "CAM", minutes: 60, goals: 0, assists: 3, result: "win", score: [5, 1], opponent: "Canal Street Rangers", rating: 8, skills: { pas: 8.5, dri: 7.5, def: 6.5 }, notes: "Played in the hole. Three assists from three through balls." },
  { daysAgo: 47, format: "11v11", position: "ST", minutes: 85, goals: 1, assists: 0, result: "draw", score: [1, 1], opponent: "St Luke's Old Boys", rating: 7, skills: { sho: 7, phy: 7.5, pac: 7 } },
  { daysAgo: 40, format: "5v5", position: "LW", minutes: 40, goals: 1, assists: 1, result: "draw", score: [4, 4], opponent: "Astro Boys", rating: 7, skills: { dri: 7.5, pac: 7.5 }, mapped: false },
  { daysAgo: 33, format: "11v11", position: "ST", minutes: 90, goals: 1, assists: 1, result: "win", score: [3, 0], opponent: "Harbour Lane", rating: 7.5, skills: { sho: 7.5, pas: 7, phy: 7.5, pac: 7.5 } },
  { daysAgo: 26, format: "11v11", position: "LW", minutes: 90, goals: 0, assists: 2, result: "win", score: [4, 2], opponent: "Eastfield Athletic", rating: 7.5, skills: { dri: 8, pac: 8, pas: 7.5, def: 6 }, notes: "Moved wide for the injured winger. Got joy on the overlap." },
  { daysAgo: 19, format: "5v5", position: "ST", minutes: 34, goals: 0, assists: 0, result: "loss", score: [2, 5], opponent: "Goalhangers", rating: 5.5, skills: { sho: 5, phy: 6 }, notes: "Went off early with a tight hamstring." },
  { daysAgo: 12, format: "11v11", position: "ST", minutes: 80, goals: 1, assists: 0, result: "draw", score: [2, 2], opponent: "Millbrook Town", rating: 7, skills: { sho: 7.5, pac: 7, phy: 7 } },
  { daysAgo: 8, format: "7v7", position: "ST", minutes: 60, goals: 2, assists: 1, result: "win", score: [5, 3], opponent: "Canal Street Rangers", rating: 8, skills: { sho: 8, pas: 7.5, dri: 7.5 } },
  { daysAgo: 1, format: "11v11", position: "ST", minutes: 90, goals: 2, assists: 1, result: "win", score: [4, 1], opponent: "Northgate United", rating: 9, skills: { sho: 9, pac: 8, pas: 7.5, dri: 8, phy: 7.5 }, notes: "Two and an assist against the league leaders. Best 90 minutes of my life." },
];

/** Where a player in each position tends to be: [col, row, weight]. */
const ACTIVITY_TEMPLATES: Partial<Record<Position, [number, number, number][]>> = {
  ST: [[10, 3, 3], [10, 4, 3], [9, 3, 3], [9, 4, 2], [11, 3, 2], [11, 4, 2], [8, 4, 2], [8, 3, 1], [9, 2, 1], [9, 5, 2], [7, 3, 1], [10, 5, 1]],
  LW: [[9, 0, 3], [8, 0, 3], [9, 1, 3], [10, 1, 3], [7, 1, 2], [8, 1, 2], [10, 2, 2], [6, 0, 1], [10, 3, 1]],
  CAM: [[8, 3, 3], [8, 4, 3], [7, 3, 3], [7, 4, 2], [9, 3, 2], [9, 4, 2], [6, 3, 1], [8, 2, 2], [8, 5, 1], [6, 4, 1]],
};

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleZones(position: Position, seed: number): ZoneCell[] {
  const random = seeded(seed);
  const template = ACTIVITY_TEMPLATES[position] ?? ACTIVITY_TEMPLATES.ST!;
  const cells = new Map<string, ZoneCell>();
  for (const [col, row, weight] of template) {
    if (random() > 0.45 + weight * 0.18) continue;
    const c = Math.min(ZONE_COLS - 1, Math.max(0, col + Math.round((random() - 0.5) * 1.4)));
    const r = Math.min(ZONE_ROWS - 1, Math.max(0, row + Math.round((random() - 0.5) * 1.4)));
    const intensity = Math.min(3, Math.max(1, weight - (random() > 0.6 ? 1 : 0))) as ZoneCell["intensity"];
    cells.set(`${c}-${r}`, { col: c, row: r, intensity });
  }
  return [...cells.values()];
}

function isoDaysAgo(days: number, now: Date) {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Dates are relative to first launch so the demo always looks current. */
export function buildSampleMatches(now = new Date()): Match[] {
  return ROWS.map((row, index) => {
    const date = isoDaysAgo(row.daysAgo, now);
    return {
      id: `demo-${String(index + 1).padStart(2, "0")}`,
      createdAt: `${date}T21:00:00.000Z`,
      isSample: true,
      date,
      format: row.format,
      position: row.position,
      minutes: row.minutes,
      goals: row.goals,
      assists: row.assists,
      result: row.result,
      opponent: row.opponent,
      teamScore: row.score[0],
      opponentScore: row.score[1],
      rating: row.rating,
      skillRatings: row.skills,
      zones: row.mapped === false ? [] : sampleZones(row.position, index * 97 + 13),
      notes: row.notes,
    };
  });
}
