"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ATTRIBUTES, ATTRIBUTE_KEYS, type AttributeKey } from "@/lib/domain";
import type { Career, MatchProgress } from "@/lib/engine/career";
import { RULES } from "@/lib/engine/rules";
import { contributionsByMonth, formatDay, formatMonth, rollingAverage, scoreline } from "@/lib/stats";
import type { Match } from "@/lib/schema";

// Recharts writes these as SVG attributes, so they mirror the CSS tokens.
const LIME = "#c8ff00";
const OFF_WHITE = "#e8e8e8";
const CONTEXT_BAR = "#3a3a3a";
const MUTED_LINE = "#6e6e6e";
const SURFACE = "#1a1a1a";
const GRID = "rgb(245 245 245 / 7%)";
const TICK = { fill: "#a3a3a3", fontSize: 11, fontWeight: 500, fontFamily: "var(--font-montserrat)" };

function TipBox({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2.5 text-xs shadow-xl">
      <p className="mb-1.5 font-semibold">{title}</p>
      {rows.map(([label, value]) => (
        <p key={label} className="flex justify-between gap-5 text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium text-foreground tabular-nums">{value}</span>
        </p>
      ))}
    </div>
  );
}

function matchTitle(match: Match) {
  return `${formatDay(match.date)}${match.opponent ? ` · ${match.opponent}` : ""}`;
}

interface OvrPoint {
  index: number;
  date: string;
  ovr: number;
  match: Match;
}

export function OvrChart({ timeline, height = 240 }: { timeline: MatchProgress[]; height?: number }) {
  const data = useMemo<OvrPoint[]>(
    () => timeline.map((entry, index) => ({ index, date: entry.match.date, ovr: entry.ovrAfter, match: entry.match })),
    [timeline],
  );
  const values = data.map((point) => point.ovr);
  const floor = Math.floor(Math.min(...values) / 5) * 5;
  const ceiling = Math.ceil((Math.max(...values) + 1) / 5) * 5;
  const lastIndex = data.length - 1;

  return (
    <div
      role="img"
      aria-label={`Overall rating across ${data.length} matches, from ${values[0]} to ${values[lastIndex]}`}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 18, right: 22, bottom: 0, left: -22 }}>
          <defs>
            <linearGradient id="ovr-wash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={LIME} stopOpacity={0.12} />
              <stop offset="1" stopColor={LIME} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="index"
            type="number"
            domain={[0, Math.max(lastIndex, 1)]}
            tickFormatter={(index: number) => (data[index] ? formatDay(data[index].date) : "")}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            minTickGap={44}
          />
          <YAxis domain={[floor, ceiling]} tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "rgb(255 255 255 / 25%)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as OvrPoint | undefined;
              if (!active || !point) return null;
              return <TipBox title={matchTitle(point.match)} rows={[["OVR", point.ovr], ["Match rating", point.match.rating.toFixed(1)]]} />;
            }}
          />
          <Area
            type="monotone"
            dataKey="ovr"
            stroke={LIME}
            strokeWidth={2}
            fill="url(#ovr-wash)"
            isAnimationActive
            animationDuration={900}
            activeDot={{ r: 5, fill: LIME, stroke: SURFACE, strokeWidth: 2 }}
            dot={(props: { cx?: number; cy?: number; index?: number; value?: number | number[] }) => {
              if (props.index !== lastIndex || props.cx === undefined || props.cy === undefined) {
                return <g key={props.index} />;
              }
              const value = Array.isArray(props.value) ? props.value[1] : props.value;
              return (
                <g key={props.index}>
                  <circle cx={props.cx} cy={props.cy} r={5} fill={LIME} stroke={SURFACE} strokeWidth={2} />
                  <text
                    x={props.cx}
                    y={props.cy - 12}
                    textAnchor="middle"
                    fill="#f5f5f5"
                    fontFamily="var(--font-montserrat)"
                    fontSize={14}
                    fontWeight={700}
                  >
                    {value}
                  </text>
                </g>
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface RatingPoint {
  index: number;
  rating: number;
  average: number | null;
  match: Match;
}

export function RatingTrendChart({ timeline }: { timeline: MatchProgress[] }) {
  const router = useRouter();
  const data = useMemo<RatingPoint[]>(() => {
    const averages = rollingAverage(timeline.map((entry) => entry.match.rating), 5);
    return timeline.map((entry, index) => ({
      index,
      rating: entry.match.rating,
      average: averages[index],
      match: entry.match,
    }));
  }, [timeline]);

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-3 w-2 rounded-t-[2px]" style={{ background: CONTEXT_BAR }} />
          Match rating
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded-full" style={{ background: LIME }} />
          5-match average
        </span>
      </div>
      <div role="img" aria-label={`Match ratings for ${data.length} matches with a five match rolling average`} className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -26 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="index"
              tickFormatter={(index: number) => (data[index] ? formatDay(data[index].match.date) : "")}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              minTickGap={44}
            />
            <YAxis domain={[0, 10]} ticks={[0, 5, 10]} tick={TICK} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgb(255 255 255 / 4%)" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as RatingPoint | undefined;
                if (!active || !point) return null;
                const rows: [string, string][] = [["Rating", point.rating.toFixed(1)]];
                if (point.average !== null) rows.push(["5-match average", point.average.toFixed(2)]);
                const score = scoreline(point.match);
                if (score) rows.push(["Score", score]);
                return <TipBox title={matchTitle(point.match)} rows={rows} />;
              }}
            />
            <Bar
              dataKey="rating"
              fill={CONTEXT_BAR}
              activeBar={{ fill: MUTED_LINE }}
              radius={[3, 3, 0, 0]}
              maxBarSize={24}
              cursor="pointer"
              onClick={(entry) => {
                const point = (entry as { payload?: RatingPoint }).payload;
                if (point) router.push(`/matches/${point.match.id}`);
              }}
            />
            <Line
              dataKey="average"
              stroke={LIME}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: LIME, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls={false}
              type="monotone"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Select a bar to open that match report.</p>
    </>
  );
}

function MonthlyBars({
  title,
  dataKey,
  data,
  color,
}: {
  title: string;
  dataKey: "goals" | "assists";
  data: ReturnType<typeof contributionsByMonth>;
  color: string;
}) {
  const total = data.reduce((sum, month) => sum + month[dataKey], 0);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="eyebrow">{title} by month</h3>
        <span className="stat text-stat">{total}</span>
      </div>
      <div role="img" aria-label={`${title} by month, ${total} in total`} className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 2, bottom: 0, left: 2 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="month"
              tickFormatter={(month: string) => formatMonth(month)}
              tick={TICK}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis hide allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgb(255 255 255 / 4%)" }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !point) return null;
                return (
                  <TipBox
                    title={formatMonth(point.month)}
                    rows={[[title, point[dataKey]], ["Matches", point.matches]]}
                  />
                );
              }}
            />
            <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} maxBarSize={24}>
              <LabelList
                dataKey={dataKey}
                position="top"
                fill="#f5f5f5"
                fontSize={11}
                fontWeight={600}
                fontFamily="var(--font-montserrat)"
                formatter={(value: unknown) => (value ? String(value) : "")}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ContributionCharts({ matches }: { matches: Match[] }) {
  const data = useMemo(() => contributionsByMonth(matches), [matches]);
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <MonthlyBars title="Goals" dataKey="goals" data={data} color={LIME} />
      <MonthlyBars title="Assists" dataKey="assists" data={data} color={OFF_WHITE} />
    </div>
  );
}

interface SparkPoint {
  index: number;
  value: number;
  match: Match | null;
}

function AttributeSpark({
  attribute,
  career,
  domain,
}: {
  attribute: AttributeKey;
  career: Career;
  domain: [number, number];
}) {
  const data = useMemo<SparkPoint[]>(
    () => [
      { index: 0, value: RULES.attributes.baseline, match: null },
      ...career.timeline.map((entry, index) => ({
        index: index + 1,
        value: entry.attributes[attribute],
        match: entry.match,
      })),
    ],
    [career, attribute],
  );
  const meta = ATTRIBUTES[attribute];
  const current = career.attributes[attribute];
  const change = current - RULES.attributes.baseline;
  const lowData = career.evidence[attribute] < RULES.attributes.lowDataBelow;

  return (
    <div className="rounded-lg border border-border bg-surface/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-sm leading-none font-bold tracking-wide">{meta.code}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {career.evidence[attribute]} rated {career.evidence[attribute] === 1 ? "match" : "matches"}
          </p>
        </div>
        <div className="text-right">
          <p className="stat text-stat">{Math.round(current)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {change >= 0 ? "+" : "−"}
            {Math.abs(change).toFixed(1)}
          </p>
        </div>
      </div>
      <div role="img" aria-label={`${meta.name} moved from ${RULES.attributes.baseline} to ${Math.round(current)}`} className="mt-2 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 2, left: 4 }}>
            <defs>
              <linearGradient id={`spark-${attribute}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={LIME} stopOpacity={0.14} />
                <stop offset="1" stopColor={LIME} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={domain} />
            <Tooltip
              cursor={{ stroke: "rgb(255 255 255 / 25%)" }}
              wrapperStyle={{ zIndex: 20 }}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as SparkPoint | undefined;
                if (!active || !point) return null;
                return (
                  <TipBox
                    title={point.match ? matchTitle(point.match) : "Starting baseline"}
                    rows={[[meta.code, point.value.toFixed(1)]]}
                  />
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={lowData ? MUTED_LINE : LIME}
              strokeWidth={2}
              fill={`url(#spark-${attribute})`}
              dot={false}
              activeDot={{ r: 4, fill: LIME, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {lowData ? <p className="mt-1 text-xs text-muted-foreground">Low data: treat with caution</p> : null}
    </div>
  );
}

/** Small multiples on one shared scale, so gains compare at a glance. */
export function AttributeSparks({ career }: { career: Career }) {
  const domain = useMemo<[number, number]>(() => {
    const values = career.timeline.flatMap((entry) => ATTRIBUTE_KEYS.map((key) => entry.attributes[key]));
    return [Math.min(45, ...values), Math.max(70, ...values)];
  }, [career]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {ATTRIBUTE_KEYS.map((key) => (
        <AttributeSpark key={key} attribute={key} career={career} domain={domain} />
      ))}
    </div>
  );
}
