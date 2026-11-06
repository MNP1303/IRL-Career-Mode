import type { Match } from "@/lib/schema";
import { chronological } from "@/lib/engine/career";

export const ALL_TIME = "career";

/** Seasons run August to July, labelled like 2026/27. */
export function seasonOf(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 8 ? year : year - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export function seasonsIn(matches: Match[]) {
  return [...new Set(matches.map((match) => seasonOf(match.date)))].sort().reverse();
}

export function inScope(matches: Match[], scope: string) {
  return scope === ALL_TIME ? matches : matches.filter((match) => seasonOf(match.date) === scope);
}

export interface Summary {
  matches: number;
  goals: number;
  assists: number;
  minutes: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number | null;
  averageRating: number | null;
}

export function summarise(matches: Match[]): Summary {
  const wins = matches.filter((match) => match.result === "win").length;
  const draws = matches.filter((match) => match.result === "draw").length;
  const count = matches.length;
  return {
    matches: count,
    goals: matches.reduce((sum, match) => sum + match.goals, 0),
    assists: matches.reduce((sum, match) => sum + match.assists, 0),
    minutes: matches.reduce((sum, match) => sum + match.minutes, 0),
    wins,
    draws,
    losses: count - wins - draws,
    winRate: count ? wins / count : null,
    averageRating: count
      ? matches.reduce((sum, match) => sum + match.rating, 0) / count
      : null,
  };
}

export function recentForm(matches: Match[], count = 5) {
  return chronological(matches).slice(-count);
}

export function rollingAverage(values: number[], window: number) {
  return values.map((_, index) => {
    if (index + 1 < window) return null;
    const slice = values.slice(index + 1 - window, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / window;
  });
}

export function contributionsByMonth(matches: Match[]) {
  const months = new Map<string, { month: string; goals: number; assists: number; matches: number }>();
  for (const match of chronological(matches)) {
    const month = match.date.slice(0, 7);
    const entry = months.get(month) ?? { month, goals: 0, assists: 0, matches: 0 };
    entry.goals += match.goals;
    entry.assists += match.assists;
    entry.matches += 1;
    months.set(month, entry);
  }
  return [...months.values()];
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fullFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export const formatDay = (date: string) => dayFormat.format(asUtc(date));
export const formatDate = (date: string) => fullFormat.format(asUtc(date));
export const formatMonth = (month: string) => monthFormat.format(asUtc(`${month}-01`));

/** Today in the player's own time zone, as a stored match date. */
export function todayIso(now = new Date()) {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function scoreline(match: Match) {
  return match.teamScore !== undefined && match.opponentScore !== undefined
    ? `${match.teamScore}–${match.opponentScore}`
    : null;
}
