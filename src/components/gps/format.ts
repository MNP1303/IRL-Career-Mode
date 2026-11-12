import type { MetricValue, Provenance } from "@/lib/gps/types";

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${seconds} s`;
}

export function formatClock(t: number) {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDay(t: number) {
  return new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Local calendar date as YYYY-MM-DD, to compare with a match's date. */
export function localIsoDate(t: number) {
  const date = new Date(t);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "HH:MM:SS" for a time input. */
export function toTimeInput(t: number) {
  const date = new Date(t);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/**
 * A time input's "HH:MM(:SS)" as a timestamp on the day of `near`, picking
 * the day before or after when that lands closer (activities can cross
 * midnight).
 */
export function fromTimeInput(value: string, near: number) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const base = new Date(near);
  base.setHours(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 0);
  const candidates = [-1, 0, 1].map((days) => base.getTime() + days * 86_400_000);
  return candidates.reduce((best, candidate) => (Math.abs(candidate - near) < Math.abs(best - near) ? candidate : best));
}

export function formatMetric(metric: MetricValue) {
  if (metric.value === null) return "—";
  switch (metric.unit) {
    case "m":
      return metric.value >= 1000 ? `${(metric.value / 1000).toFixed(2)} km` : `${Math.round(metric.value)} m`;
    case "s":
      return formatDuration(metric.value * 1000);
    case "m/s":
      return `${(metric.value * 3.6).toFixed(1)} km/h`;
    case "bpm":
      return `${Math.round(metric.value)} bpm`;
    case "count":
      return String(Math.round(metric.value));
  }
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  device: "From device",
  calculated: "Calculated",
  approximate: "Approximate",
  unavailable: "Unavailable",
};

export function compassName(bearing: number) {
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(bearing / 45) % 8];
}
