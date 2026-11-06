import {
  ATTRIBUTE_KEYS,
  FORMATS,
  POSITION_META,
  type Attributes,
  type MatchFormat,
  type Position,
} from "@/lib/domain";
import type { Match } from "@/lib/schema";
import { isCleanSheet } from "@/lib/engine/progression";

export type BadgeRarity = "common" | "rare" | "epic";

/** Running totals built up as the match log is replayed in date order. */
export interface CareerTally {
  matches: number;
  goals: number;
  assists: number;
  minutes: number;
  wins: number;
  cleanSheets: number;
  bestGoalsInMatch: number;
  bestAssistsInMatch: number;
  bestRating: number;
  unbeatenRun: number;
  bestUnbeatenRun: number;
  winRun: number;
  bestWinRun: number;
  contributionRun: number;
  bestContributionRun: number;
  goodFormRun: number;
  bestGoodFormRun: number;
  formats: Set<MatchFormat>;
  lines: Set<string>;
  dates: string[];
  bestMonth: number;
  bestAttribute: number;
  ovr: number;
}

export function emptyTally(): CareerTally {
  return {
    matches: 0,
    goals: 0,
    assists: 0,
    minutes: 0,
    wins: 0,
    cleanSheets: 0,
    bestGoalsInMatch: 0,
    bestAssistsInMatch: 0,
    bestRating: 0,
    unbeatenRun: 0,
    bestUnbeatenRun: 0,
    winRun: 0,
    bestWinRun: 0,
    contributionRun: 0,
    bestContributionRun: 0,
    goodFormRun: 0,
    bestGoodFormRun: 0,
    formats: new Set(),
    lines: new Set(),
    dates: [],
    bestMonth: 0,
    bestAttribute: 50,
    ovr: 0,
  };
}

export const GOOD_FORM_RATING = 7;

export function advanceTally(
  tally: CareerTally,
  match: Match,
  attributes: Attributes,
  ovr: number,
) {
  tally.matches += 1;
  tally.goals += match.goals;
  tally.assists += match.assists;
  tally.minutes += match.minutes;
  if (match.result === "win") tally.wins += 1;
  if (isCleanSheet(match)) tally.cleanSheets += 1;

  tally.bestGoalsInMatch = Math.max(tally.bestGoalsInMatch, match.goals);
  tally.bestAssistsInMatch = Math.max(tally.bestAssistsInMatch, match.assists);
  tally.bestRating = Math.max(tally.bestRating, match.rating);

  tally.unbeatenRun = match.result === "loss" ? 0 : tally.unbeatenRun + 1;
  tally.bestUnbeatenRun = Math.max(tally.bestUnbeatenRun, tally.unbeatenRun);
  tally.winRun = match.result === "win" ? tally.winRun + 1 : 0;
  tally.bestWinRun = Math.max(tally.bestWinRun, tally.winRun);
  tally.contributionRun = match.goals + match.assists > 0 ? tally.contributionRun + 1 : 0;
  tally.bestContributionRun = Math.max(tally.bestContributionRun, tally.contributionRun);
  tally.goodFormRun = match.rating >= GOOD_FORM_RATING ? tally.goodFormRun + 1 : 0;
  tally.bestGoodFormRun = Math.max(tally.bestGoodFormRun, tally.goodFormRun);

  tally.formats.add(match.format);
  tally.lines.add(POSITION_META[match.position as Position].line);

  tally.dates.push(match.date);
  const month = match.date.slice(0, 7);
  tally.bestMonth = Math.max(
    tally.bestMonth,
    tally.dates.filter((date) => date.startsWith(month)).length,
  );
  tally.bestAttribute = Math.max(...ATTRIBUTE_KEYS.map((key) => attributes[key]));
  tally.ovr = Math.max(tally.ovr, ovr);
}

export type BadgeIcon =
  | "whistle"
  | "goal"
  | "assist"
  | "hattrick"
  | "playmaker"
  | "motm"
  | "form"
  | "shield"
  | "streak"
  | "clock"
  | "formats"
  | "versatile"
  | "calendar"
  | "star"
  | "trophy";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  rarity: BadgeRarity;
  icon: BadgeIcon;
  target: number;
  value: (tally: CareerTally) => number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-whistle", name: "First Whistle", description: "Log your first match", rarity: "common", icon: "whistle", target: 1, value: (t) => t.matches },
  { id: "off-the-mark", name: "Off the Mark", description: "Score your first goal", rarity: "common", icon: "goal", target: 1, value: (t) => t.goals },
  { id: "provider", name: "Provider", description: "Record your first assist", rarity: "common", icon: "assist", target: 1, value: (t) => t.assists },
  { id: "hat-trick", name: "Hat-trick Hero", description: "Score 3 goals in one match", rarity: "rare", icon: "hattrick", target: 3, value: (t) => t.bestGoalsInMatch },
  { id: "playmaker", name: "Playmaker", description: "Record 3 assists in one match", rarity: "rare", icon: "playmaker", target: 3, value: (t) => t.bestAssistsInMatch },
  { id: "motm", name: "Star Performer", description: "Rate a match 9.0 or higher", rarity: "rare", icon: "motm", target: 9, value: (t) => t.bestRating },
  { id: "good-form", name: "In Form", description: `Rate ${GOOD_FORM_RATING}.0 or higher in 5 straight matches`, rarity: "rare", icon: "form", target: 5, value: (t) => t.bestGoodFormRun },
  { id: "unbeaten", name: "Hard to Beat", description: "Go 5 matches unbeaten", rarity: "common", icon: "shield", target: 5, value: (t) => t.bestUnbeatenRun },
  { id: "invincible", name: "Unbeaten Machine", description: "Go 10 matches unbeaten", rarity: "epic", icon: "shield", target: 10, value: (t) => t.bestUnbeatenRun },
  { id: "win-streak", name: "Winning Habit", description: "Win 5 matches in a row", rarity: "rare", icon: "streak", target: 5, value: (t) => t.bestWinRun },
  { id: "involved", name: "Always Involved", description: "Score or assist in 5 straight matches", rarity: "rare", icon: "streak", target: 5, value: (t) => t.bestContributionRun },
  { id: "clean-sheets", name: "Shut Out", description: "Keep 3 recorded clean sheets as a keeper or defender", rarity: "rare", icon: "shield", target: 3, value: (t) => t.cleanSheets },
  { id: "all-formats", name: "Any Pitch, Any Size", description: "Play 5v5, 7v7 and 11v11", rarity: "common", icon: "formats", target: FORMATS.length, value: (t) => t.formats.size },
  { id: "versatile", name: "Utility Player", description: "Play in 3 different lines of the team", rarity: "rare", icon: "versatile", target: 3, value: (t) => t.lines.size },
  { id: "busy-month", name: "Fixture Pile-up", description: "Play 6 matches in one calendar month", rarity: "common", icon: "calendar", target: 6, value: (t) => t.bestMonth },
  { id: "matches-10", name: "Ten Up", description: "Play 10 matches", rarity: "common", icon: "trophy", target: 10, value: (t) => t.matches },
  { id: "matches-25", name: "Season Regular", description: "Play 25 matches", rarity: "rare", icon: "trophy", target: 25, value: (t) => t.matches },
  { id: "matches-50", name: "Half Century", description: "Play 50 matches", rarity: "epic", icon: "trophy", target: 50, value: (t) => t.matches },
  { id: "goals-10", name: "Double Figures", description: "Score 10 career goals", rarity: "common", icon: "goal", target: 10, value: (t) => t.goals },
  { id: "goals-25", name: "Goal Machine", description: "Score 25 career goals", rarity: "rare", icon: "goal", target: 25, value: (t) => t.goals },
  { id: "goals-50", name: "Half a Hundred", description: "Score 50 career goals", rarity: "epic", icon: "goal", target: 50, value: (t) => t.goals },
  { id: "assists-10", name: "Creator", description: "Record 10 career assists", rarity: "common", icon: "assist", target: 10, value: (t) => t.assists },
  { id: "assists-25", name: "Master Creator", description: "Record 25 career assists", rarity: "epic", icon: "assist", target: 25, value: (t) => t.assists },
  { id: "minutes-1000", name: "Thousand Minutes", description: "Play 1,000 minutes", rarity: "common", icon: "clock", target: 1000, value: (t) => t.minutes },
  { id: "minutes-5000", name: "Iron Lungs", description: "Play 5,000 minutes", rarity: "epic", icon: "clock", target: 5000, value: (t) => t.minutes },
  { id: "attribute-70", name: "Signature Skill", description: "Develop any attribute to 70", rarity: "rare", icon: "star", target: 70, value: (t) => Math.floor(t.bestAttribute) },
  { id: "ovr-65", name: "First Team Card", description: "Reach 65 OVR", rarity: "rare", icon: "star", target: 65, value: (t) => t.ovr },
  { id: "ovr-75", name: "Elite Card", description: "Reach 75 OVR", rarity: "epic", icon: "star", target: 75, value: (t) => t.ovr },
];
