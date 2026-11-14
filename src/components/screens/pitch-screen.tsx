"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  MapPinned,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HeatLayer,
  HeatLegend,
  ZoneBreakdown,
} from "@/components/pitch/heat-layer";
import {
  LazyPitch3D,
  type PitchView,
  prefersLiteRendering,
  preloadPitch3D,
  supportsWebGL,
} from "@/components/pitch/pitch-3d-lazy";
import {
  AttackHint,
  Pitch,
  pointerToCell,
  uprightTransform,
  usePitchOrientation,
} from "@/components/pitch/pitch";
import {
  EmptyState,
  LinkButton,
  PageHeader,
  Reveal,
  Segmented,
} from "@/components/shared/primitives";
import { PITCH, POSITION_META, ZONE_COLS, ZONE_ROWS, type Position } from "@/lib/domain";
import { gridZoneShares } from "@/lib/gps/heatmap";
import { SEASON_PITCH } from "@/lib/gps/season";
import { GpsHeatLegend, GpsPitch } from "@/components/gps/gps-pitch";
import { ZoneShareBars } from "@/components/gps/zone-shares";
import { useSeasonGps, useSeasonGrid } from "@/components/gps/season-gps";
import { chronological } from "@/lib/engine/career";
import {
  aggregateZones,
  cellIndex,
  describeCell,
  zoneShares,
} from "@/lib/heatmap";
import type { Match } from "@/lib/schema";
import {
  ALL_TIME,
  formatDay,
  inScope,
  scoreline,
  seasonsIn,
} from "@/lib/stats";
import { useCareer } from "@/lib/store";

const ALL_POSITIONS = "all";
const VIEW_KEY = "irl-career-mode:pitch-view";
const SOURCE_KEY = "irl-career-mode:pitch-source";
const EMPTY_ZONES = new Array(ZONE_COLS * ZONE_ROWS).fill(0);

/** Where the heatmap comes from: zones painted by hand, or GPS files. */
type HeatSource = "painted" | "gps";

function storedSource(): HeatSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === "gps" ? "gps" : "painted";
  } catch {
    return "painted";
  }
}

type Dimension = "2d" | "3d";

/** The remembered view, or 3D by default where the device renders it comfortably. */
function storedDimension(lite: boolean): Dimension {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "3d" || stored === "2d") return stored;
  } catch {
    // Fall through to the default.
  }
  return lite ? "2d" : "3d";
}

function matchLabel(match: Match) {
  const score = scoreline(match);
  return `${formatDay(match.date)} · ${match.opponent ?? match.format}${score ? ` ${score}` : ""}`;
}

function PositionMarkers({
  counts,
  orientation,
}: {
  counts: [Position, number][];
  orientation: "landscape" | "portrait";
}) {
  const max = Math.max(...counts.map(([, count]) => count));
  return (
    <g className="pointer-events-none">
      {counts.map(([position, count]) => {
        const { x, y } = POSITION_META[position];
        return (
          <g key={position}>
            <circle
              cx={x}
              cy={y}
              r={2.5 + (count / max) * 1.6}
              fill="#0b1c11"
              fillOpacity="0.72"
              stroke="#fff"
              strokeOpacity="0.8"
              strokeWidth="0.25"
            />
            <text
              x={x}
              y={y}
              dy="0.9"
              textAnchor="middle"
              fontFamily="var(--font-geist)"
              fontWeight="700"
              fontSize="2.2"
              fill="#fff"
              transform={uprightTransform(orientation, x, y)}
            >
              {position}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function PitchScreen() {
  const { matches } = useCareer();
  const orientation = usePitchOrientation();
  const group = useRef<SVGGElement>(null);

  const [source, setSource] = useState<HeatSource>(storedSource);
  const seasonGps = useSeasonGps(source === "gps");
  const gpsMode = source === "gps";

  function chooseSource(next: HeatSource) {
    setSource(next);
    setHovered(null);
    try {
      localStorage.setItem(SOURCE_KEY, next);
    } catch {
      // A remembered choice is a convenience; private browsing can refuse it.
    }
  }

  const ordered = useMemo(() => chronological(matches), [matches]);
  const isMapped = useMemo(
    () =>
      gpsMode
        ? (match: Match) => seasonGps.byMatch.has(match.id)
        : (match: Match) => match.zones.length > 0,
    [gpsMode, seasonGps.byMatch],
  );
  const mapped = useMemo(() => ordered.filter(isMapped), [ordered, isMapped]);
  const seasons = useMemo(() => seasonsIn(matches), [matches]);

  const [view, setView] = useState<"season" | "match">("season");
  const [scope, setScope] = useState<string>(seasons[0] ?? ALL_TIME);
  const [positionFilter, setPositionFilter] = useState<string>(ALL_POSITIONS);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [showPositions, setShowPositions] = useState(true);
  const [hovered, setHovered] = useState<{ col: number; row: number } | null>(
    null,
  );

  // This screen only renders in the browser (the shell waits for local data), so these are safe here.
  const [webgl] = useState(supportsWebGL);
  const [lite] = useState(prefersLiteRendering);
  const [dimension, setDimension] = useState<Dimension>(() =>
    webgl ? storedDimension(lite) : "2d",
  );
  const [failed3d, setFailed3d] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [camera, setCamera] = useState<PitchView>("iso");
  const show3d = dimension === "3d" && webgl && !failed3d;

  function chooseDimension(next: Dimension) {
    setDimension(next);
    setHovered(null);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // A remembered view is a convenience; private browsing can refuse it.
    }
  }

  const activeScope =
    scope === ALL_TIME || seasons.includes(scope)
      ? scope
      : (seasons[0] ?? ALL_TIME);
  const scoped = useMemo(
    () => inScope(matches, activeScope),
    [matches, activeScope],
  );
  const positionsPlayed = useMemo(
    () => [...new Set(scoped.map((match) => match.position))].sort(),
    [scoped],
  );

  const selected =
    mapped.find((match) => match.id === matchId) ?? mapped.at(-1) ?? null;
  const selectedIndex = selected ? mapped.indexOf(selected) : -1;

  const pool = useMemo(() => {
    if (view === "match") return selected ? [selected] : [];
    return positionFilter === ALL_POSITIONS ||
      !positionsPlayed.includes(positionFilter as Position)
      ? scoped
      : scoped.filter((match) => match.position === positionFilter);
  }, [view, selected, scoped, positionFilter, positionsPlayed]);

  // Memoised so hovering (which re-renders) doesn't rebuild the heatmap or the 3D terrain.
  const contributing = useMemo(() => pool.filter(isMapped), [pool, isMapped]);
  const grid = useMemo(
    () => aggregateZones(gpsMode ? [] : contributing),
    [gpsMode, contributing],
  );
  const shares = useMemo(() => zoneShares(grid), [grid]);
  const gpsRows = useMemo(
    () =>
      gpsMode
        ? contributing.flatMap((match) => {
            const row = seasonGps.byMatch.get(match.id);
            return row ? [row] : [];
          })
        : [],
    [gpsMode, contributing, seasonGps.byMatch],
  );
  const gpsGrid = useSeasonGrid(gpsRows);
  const gpsShares = useMemo(
    () => (gpsGrid ? gridZoneShares(gpsGrid, SEASON_PITCH) : null),
    [gpsGrid],
  );

  const positionCounts = useMemo(() => {
    const counts = new Map<Position, number>();
    for (const match of pool)
      counts.set(match.position, (counts.get(match.position) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const hoveredShare =
    hovered && shares.total
      ? grid[cellIndex(hovered.col, hovered.row)] / shares.total
      : null;

  return (
    <Reveal>
      <PageHeader
        eyebrow="Pitch intelligence"
        title="Where you play"
        description={
          gpsMode
            ? "Heatmaps built only from your imported GPS files, each scaled onto a standard pitch."
            : "Heatmaps built only from the zones you've recorded, so unmapped matches never fill in the picture."
        }
      />

      <div className="mb-4">
        <Segmented
          label="Heatmap source"
          value={source}
          onChange={chooseSource}
          options={[
            { value: "painted", label: "Painted zones" },
            { value: "gps", label: "GPS files" },
          ]}
        />
      </div>

      {gpsMode && seasonGps.loading ? (
        <div className="skeleton h-72 rounded-lg" aria-label="Loading your GPS heatmaps" />
      ) : gpsMode && seasonGps.error ? (
        <p role="alert" className="panel p-card text-sm text-destructive">
          {seasonGps.error}
        </p>
      ) : gpsMode && mapped.length === 0 ? (
        <EmptyState
          icon={<MapPinned />}
          title="No GPS heatmaps yet"
          action={
            <LinkButton
              href={matches.length ? `/matches/${ordered.at(-1)!.id}` : "/matches/new"}
              variant="cta"
              size="lg"
            >
              {matches.length ? "Add GPS to your latest match" : "Log your first match"}
            </LinkButton>
          }
        >
          Import a GPX, TCX or FIT file on a match, or choose &ldquo;From a GPS file&rdquo; when you log one, and your GPS heatmap appears here.
        </EmptyState>
      ) : mapped.length === 0 ? (
        <EmptyState
          icon={<MapPinned />}
          title="No zones recorded yet"
          action={
            <LinkButton
              href={
                matches.length
                  ? `/matches/${ordered.at(-1)!.id}/edit`
                  : "/matches/new"
              }
              variant="cta"
              size="lg"
            >
              {matches.length
                ? "Map your latest match"
                : "Log your first match"}
            </LinkButton>
          }
        >
          Paint the areas you covered when you log a match and your heatmap
          appears here.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Segmented
              label="Heatmap view"
              value={view}
              onChange={setView}
              options={[
                { value: "season", label: "Season" },
                { value: "match", label: "Single match" },
              ]}
            />
            {view === "season" ? (
              <>
                <Select
                  value={activeScope}
                  onValueChange={(value) => value && setScope(value)}
                >
                  <SelectTrigger className="min-w-32" aria-label="Season">
                    <SelectValue>
                      {(value: string) =>
                        value === ALL_TIME ? "All seasons" : value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_TIME}>All seasons</SelectItem>
                    {seasons.map((season) => (
                      <SelectItem key={season} value={season}>
                        {season}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={positionFilter}
                  onValueChange={(value) => value && setPositionFilter(value)}
                >
                  <SelectTrigger className="min-w-36" aria-label="Position">
                    <SelectValue>
                      {(value: string) =>
                        value === ALL_POSITIONS ? "All positions" : value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_POSITIONS}>All positions</SelectItem>
                    {positionsPlayed.map((position) => (
                      <SelectItem key={position} value={position}>
                        {position}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous mapped match"
                  disabled={selectedIndex <= 0}
                  onClick={() => setMatchId(mapped[selectedIndex - 1].id)}
                >
                  <ChevronLeft />
                </Button>
                <Select
                  value={selected?.id ?? ""}
                  onValueChange={(value) => value && setMatchId(value)}
                >
                  <SelectTrigger
                    className="min-w-0 flex-1 sm:w-72 sm:flex-none"
                    aria-label="Match"
                  >
                    <SelectValue>
                      {(value: string) => {
                        const match = mapped.find(
                          (entry) => entry.id === value,
                        );
                        return match ? matchLabel(match) : "Pick a match";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    alignItemWithTrigger={false}
                    className="max-h-72"
                  >
                    {[...mapped].reverse().map((match) => (
                      <SelectItem key={match.id} value={match.id}>
                        {matchLabel(match)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next mapped match"
                  disabled={selectedIndex >= mapped.length - 1}
                  onClick={() => setMatchId(mapped[selectedIndex + 1].id)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-block lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="panel min-w-0 p-3 sm:p-card">
              {webgl && !failed3d ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div onPointerEnter={preloadPitch3D} onFocus={preloadPitch3D}>
                    <Segmented
                      label="Pitch view"
                      size="sm"
                      value={dimension}
                      onChange={chooseDimension}
                      options={[
                        { value: "2d", label: "2D", ariaLabel: "Flat heatmap" },
                        { value: "3d", label: "3D", ariaLabel: "3D heatmap" },
                      ]}
                    />
                  </div>
                  {show3d ? (
                    <div className="flex items-center gap-1">
                      <Segmented
                        label="Camera"
                        size="sm"
                        value={camera}
                        onChange={(next) => {
                          setCamera(next);
                          setResetKey((key) => key + 1);
                        }}
                        options={[
                          { value: "iso", label: "Isometric" },
                          {
                            value: "overhead",
                            label: "Tactical",
                            ariaLabel: "Overhead tactical view",
                          },
                        ]}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Reset camera"
                        title="Reset camera"
                        onClick={() => setResetKey((key) => key + 1)}
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {failed3d ? (
                <p
                  className="mb-3 rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground"
                  role="status"
                >
                  The 3D view isn&apos;t available on this device, so
                  you&apos;re seeing the flat heatmap.
                </p>
              ) : null}
              {show3d ? (
                <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_62%_38%,#14423a_0%,#0d1c1a_52%,#0b1112_100%)] sm:aspect-[16/10]">
                  <LazyPitch3D
                    grid={gpsMode ? EMPTY_ZONES : grid}
                    gps={gpsMode && gpsGrid ? { grid: gpsGrid, pitch: SEASON_PITCH } : undefined}
                    hovered={gpsMode ? null : hovered}
                    onHover={gpsMode ? () => {} : setHovered}
                    lite={lite}
                    view={camera}
                    focusKey={view === "match" ? selected?.id : undefined}
                    positions={showPositions ? positionCounts : []}
                    resetKey={resetKey}
                    onFail={() => setFailed3d(true)}
                    label={
                      gpsMode
                        ? `3D GPS heatmap from ${contributing.length} matches.`
                        : shares.hottest
                          ? `3D heatmap from ${contributing.length} matches. Most active: ${shares.hottest}.`
                          : "Flat 3D pitch. No zones recorded for this selection."
                    }
                  />
                </div>
              ) : gpsMode ? (
                gpsGrid ? (
                  <GpsPitch
                    grid={gpsGrid}
                    pitch={SEASON_PITCH}
                    label={`GPS heatmap from ${contributing.length} matches on a standard 105 by 68 metre pitch, attacking to the right.`}
                  />
                ) : (
                  <p className="grid aspect-[117/80] place-items-center rounded-lg border border-dashed border-input text-sm text-muted-foreground">
                    No GPS heatmaps for this selection. Try another season or position.
                  </p>
                )
              ) : (
                <div className="mx-auto max-w-[min(100%,62vh)] sm:max-w-none">
                  <Pitch
                    decorative
                    orientation={orientation}
                    groupRef={group}
                    label={
                      shares.hottest
                        ? `Heatmap from ${contributing.length} matches. Most active: ${shares.hottest}.`
                        : "Empty pitch. No zones recorded for this selection."
                    }
                    underlay={<HeatLayer grid={grid} />}
                  >
                    {showPositions ? (
                      <PositionMarkers
                        counts={positionCounts}
                        orientation={orientation}
                      />
                    ) : null}
                    <rect
                      width={PITCH.length}
                      height={PITCH.width}
                      fill="transparent"
                      onPointerMove={(event) =>
                        setHovered(pointerToCell(event, group.current))
                      }
                      onPointerDown={(event) =>
                        setHovered(pointerToCell(event, group.current))
                      }
                      onPointerLeave={() => setHovered(null)}
                    />
                  </Pitch>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
                {gpsMode ? <GpsHeatLegend /> : <HeatLegend />}
                {gpsMode && !show3d ? (
                  <p className="eyebrow text-primary">Attacking to the right</p>
                ) : show3d ? (
                  <p className="eyebrow text-primary">Attacking direction marked on the pitch</p>
                ) : (
                  <AttackHint orientation={orientation} />
                )}
                {show3d ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="pointer-coarse:hidden">
                      Drag to orbit, scroll to zoom
                    </span>
                    <span className="hidden pointer-coarse:inline">
                      Two fingers to orbit and zoom
                    </span>
                  </p>
                ) : null}
                {show3d && gpsMode ? (
                  <p className="w-full text-xs text-faint">
                    Each match is scaled from its own pitch size onto a standard 105 × 68 m pitch.
                  </p>
                ) : null}
                {show3d && showPositions && positionCounts.length ? (
                  <p className="w-full text-xs text-faint">
                    Markers show the positions you played, placed at each
                    role&apos;s usual spot. They&apos;re approximate: the app
                    records zones and roles, not GPS tracking.
                  </p>
                ) : null}
                {gpsMode && !show3d ? null : (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={showPositions}
                      onChange={(event) =>
                        setShowPositions(event.target.checked)
                      }
                    />
                    Show positions
                  </label>
                )}
              </div>
              <p
                className="mt-2 min-h-5 text-sm text-foreground/85"
                aria-live="polite"
              >
                {hovered
                  ? `${describeCell(hovered.col, hovered.row)} · ${Math.round((hoveredShare ?? 0) * 100)}% of recorded activity`
                  : ""}
              </p>
            </section>

            <aside className="panel p-card">
              {view === "match" && selected ? (
                <div className="mb-5 border-b border-border pb-4">
                  <p className="eyebrow">Selected match</p>
                  <Link
                    href={`/matches/${selected.id}`}
                    className="mt-1 block font-semibold hover:text-primary"
                  >
                    {selected.opponent ?? `${selected.format} match`}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {selected.position} · {selected.minutes}&prime; ·{" "}
                    {selected.goals}G {selected.assists}A
                  </p>
                </div>
              ) : (
                <div className="mb-5 border-b border-border pb-4">
                  <p className="eyebrow">Coverage</p>
                  <p className="stat mt-2 text-stat-lg">
                    {contributing.length}
                    <span className="text-base font-medium text-muted-foreground">
                      {" "}
                      of {pool.length}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {gpsMode ? "matches have a GPS heatmap" : "matches have a recorded map"}
                  </p>
                </div>
              )}

              {gpsMode ? (
                gpsShares && gpsGrid ? (
                  <div className="space-y-5">
                    <p className="text-sm text-muted-foreground">
                      {Math.round(gpsGrid.totalSeconds / 60)} minutes of tracked play.
                    </p>
                    <ZoneShareBars title="Pitch thirds (time)" items={gpsShares.thirds} />
                    <ZoneShareBars title="Channels (time)" items={gpsShares.channels} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No GPS heatmaps for this selection. Try another season or position.
                  </p>
                )
              ) : shares.total > 0 ? (
                <>
                  <div className="mb-5 flex items-start gap-2.5">
                    <Flame className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="eyebrow">Most active</p>
                      <p className="font-semibold">{shares.hottest}</p>
                    </div>
                  </div>
                  <ZoneBreakdown grid={grid} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No maps recorded for this selection. Try another season or
                  position.
                </p>
              )}

              {positionCounts.length > 0 ? (
                <div className="mt-6">
                  <h3 className="eyebrow mb-2">Positions played</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {positionCounts.map(([position, count]) => (
                      <li
                        key={position}
                        className="rounded bg-accent px-2 py-1 text-sm"
                      >
                        <span className="font-semibold">{position}</span>
                        <span className="ml-1.5 text-muted-foreground tabular-nums">
                          {count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </Reveal>
  );
}
