"use client";

/**
 * The recorded route on a plain, north-up grid in metres. No map tiles are
 * loaded (so the location never goes to a tile server) and no imagery is
 * invented; the route itself shows where the pitch is.
 *
 * In calibration mode the four corners can be placed by clicking, dragged,
 * or nudged from the keyboard (arrow keys move the selected corner 1 m,
 * Shift + arrow 5 m), and the fitted pitch outline is drawn on top.
 */

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Corners } from "@/lib/gps/calibration";
import { localProjection } from "@/lib/gps/geo";
import type { ScreenResult } from "@/lib/gps/screen";
import type { LatLon } from "@/lib/gps/types";
import { cn } from "@/lib/utils";

const MAX_DRAWN = 3000;

type Box = { minE: number; maxE: number; minN: number; maxN: number };

function scaleBarLength(span: number) {
  const target = span / 5;
  return [5, 10, 20, 50, 100, 200, 500, 1000].reduce((best, step) => (Math.abs(step - target) < Math.abs(best - target) ? step : best));
}

export function RouteMap({
  screen,
  label,
  corners,
  selectedCorner,
  onSelectCorner,
  onMoveCorner,
  outline,
  highlight,
  className,
}: {
  screen: ScreenResult;
  label: string;
  corners?: (LatLon | null)[];
  selectedCorner?: number;
  onSelectCorner?: (index: number) => void;
  onMoveCorner?: (index: number, point: LatLon) => void;
  /** The fitted rectangle (lat/lon corners) and its attack direction, drawn over the route. */
  outline?: Corners | null;
  /** Time range to emphasise (playing intervals); points outside it are dimmed. */
  highlight?: { start: number; end: number }[];
  className?: string;
}) {
  const projection = useMemo(() => localProjection(screen.reference), [screen.reference]);
  const svg = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [dragging, setDragging] = useState<number | null>(null);
  // The frame stays still while a corner is dragged, so the map doesn't slide under the pointer.
  const [frozen, setFrozen] = useState<Box | null>(null);
  const interactive = Boolean(onMoveCorner);

  const runs = useMemo(() => {
    const stride = Math.max(1, Math.ceil(screen.points.length / MAX_DRAWN));
    const result: { points: string; inside: boolean }[] = [];
    let current: string[] = [];
    let inside = true;
    const isInside = (t: number) => !highlight || highlight.some((range) => t >= range.start && t <= range.end);
    screen.points.forEach((point, index) => {
      if (point.excluded) return;
      const pointInside = isInside(point.t);
      const breaks = point.breakBefore || pointInside !== inside;
      if (breaks && current.length) {
        result.push({ points: current.join(" "), inside });
        current = [];
      }
      inside = pointInside;
      if (index % stride === 0 || breaks) current.push(`${point.e.toFixed(1)},${(-point.n).toFixed(1)}`);
    });
    if (current.length) result.push({ points: current.join(" "), inside });
    return result;
  }, [screen.points, highlight]);

  const excluded = useMemo(() => screen.points.filter((point) => point.excluded && point.excluded !== "duplicate-timestamp").slice(0, 400), [screen.points]);
  const cornerPoints = (corners ?? []).map((corner) => (corner ? projection.forward(corner) : null));
  const outlinePoints = outline?.map((corner) => projection.forward(corner));

  const cornerKey = cornerPoints.map((c) => (c ? `${Math.round(c.e / 10)},${Math.round(c.n / 10)}` : "-")).join(";");
  const box = useMemo<Box>(() => {
    let minE = Infinity;
    let maxE = -Infinity;
    let minN = Infinity;
    let maxN = -Infinity;
    const add = (e: number, n: number) => {
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    };
    for (const point of screen.points) if (!point.excluded) add(point.e, point.n);
    for (const corner of cornerPoints) if (corner) add(corner.e, corner.n);
    const pad = Math.max(10, (maxE - minE + maxN - minN) * 0.06);
    return { minE: minE - pad, maxE: maxE + pad, minN: minN - pad, maxN: maxN + pad };
    // Corners widen the frame only when they move by ~10 m, not on every pixel of a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.points, cornerKey]);
  const view = dragging !== null && frozen ? frozen : box;
  const width = view.maxE - view.minE;
  const height = view.maxN - view.minN;
  const unit = Math.max(width, height) / 300;
  const bar = scaleBarLength(width);

  function toLatLon(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return projection.inverse(point.x, -point.y);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!interactive || selectedCorner === undefined) return;
    const target = (event.target as Element).closest("[data-corner]");
    const index = target ? Number(target.getAttribute("data-corner")) : selectedCorner;
    onSelectCorner?.(index);
    setFrozen(view);
    setDragging(index);
    svg.current?.setPointerCapture(event.pointerId);
    const point = toLatLon(event);
    if (point) onMoveCorner?.(index, point);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (dragging === null) return;
    const point = toLatLon(event);
    if (point) onMoveCorner?.(dragging, point);
  }

  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (dragging === null) return;
    svg.current?.releasePointerCapture(event.pointerId);
    setDragging(null);
    setFrozen(null);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (!interactive || selectedCorner === undefined) return;
    const corner = corners?.[selectedCorner];
    if (/^[1-4]$/.test(event.key)) {
      onSelectCorner?.(Number(event.key) - 1);
      event.preventDefault();
      return;
    }
    const step = event.shiftKey ? 5 : 1;
    const moves: Record<string, [number, number]> = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const base = corner ? projection.forward(corner) : { e: (view.minE + view.maxE) / 2, n: (view.minN + view.maxN) / 2 };
    onMoveCorner?.(selectedCorner, projection.inverse(base.e + move[0], base.n + move[1]));
  }

  return (
    <svg
      ref={svg}
      viewBox={`${view.minE} ${-view.maxN} ${width} ${height}`}
      role={interactive ? "application" : "img"}
      aria-label={label}
      aria-roledescription={interactive ? "Corner placement map" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        "block w-full touch-none rounded-lg bg-[#0d1410] outline-none focus-visible:ring-3 focus-visible:ring-ring/60",
        interactive && "cursor-crosshair",
        className,
      )}
      style={{ aspectRatio: `${Math.max(0.6, Math.min(2.2, width / height))}` }}
    >
      <defs>
        <pattern id={`route-grid-${uid}`} width={10} height={10} patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="#f2f0e9" strokeOpacity={0.05} strokeWidth={unit * 0.6} />
        </pattern>
      </defs>
      <rect x={view.minE} y={-view.maxN} width={width} height={height} fill={`url(#route-grid-${uid})`} />

      {outlinePoints ? (
        <g aria-hidden>
          <polygon
            points={outlinePoints.map((p) => `${p.e},${-p.n}`).join(" ")}
            fill="#c8ff00"
            fillOpacity={0.05}
            stroke="#c8ff00"
            strokeOpacity={0.75}
            strokeWidth={unit * 1.4}
            strokeDasharray={`${unit * 4} ${unit * 3}`}
          />
          <line
            x1={(outlinePoints[0].e + outlinePoints[3].e) / 2}
            y1={-(outlinePoints[0].n + outlinePoints[3].n) / 2}
            x2={(outlinePoints[1].e + outlinePoints[2].e) / 2}
            y2={-(outlinePoints[1].n + outlinePoints[2].n) / 2}
            stroke="#c8ff00"
            strokeOpacity={0.35}
            strokeWidth={unit}
            markerEnd={`url(#attack-arrow-${uid})`}
          />
          <marker id={`attack-arrow-${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#c8ff00" fillOpacity={0.7} />
          </marker>
        </g>
      ) : null}

      <g fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
        {runs.map((run, index) => (
          <polyline
            key={index}
            points={run.points}
            stroke={run.inside ? "#f2f0e9" : "#6f6e68"}
            strokeOpacity={run.inside ? 0.62 : 0.35}
            strokeWidth={unit * (run.inside ? 1.1 : 0.8)}
          />
        ))}
      </g>
      <g aria-hidden stroke="#ff5f52" strokeWidth={unit * 0.9}>
        {excluded.map((point, index) => (
          <path key={index} d={`M${point.e - unit * 2} ${-point.n - unit * 2}l${unit * 4} ${unit * 4}m0 ${-unit * 4}l${-unit * 4} ${unit * 4}`} />
        ))}
      </g>

      {cornerPoints.map((corner, index) =>
        corner ? (
          <g key={index} data-corner={index} className={interactive ? "cursor-grab" : undefined}>
            <circle cx={corner.e} cy={-corner.n} r={unit * 9} fill="transparent" />
            <circle
              cx={corner.e}
              cy={-corner.n}
              r={unit * (index === selectedCorner ? 5.5 : 4.5)}
              fill={index === selectedCorner ? "#c8ff00" : "#111213"}
              stroke="#c8ff00"
              strokeWidth={unit * 1.2}
            />
            <text
              x={corner.e}
              y={-corner.n + unit * 2.2}
              textAnchor="middle"
              fontSize={unit * 6}
              fontWeight={700}
              fill={index === selectedCorner ? "#111213" : "#c8ff00"}
              pointerEvents="none"
            >
              {index + 1}
            </text>
          </g>
        ) : null,
      )}

      <g aria-hidden>
        <line
          x1={view.maxE - bar - unit * 8}
          x2={view.maxE - unit * 8}
          y1={-view.minN - unit * 8}
          y2={-view.minN - unit * 8}
          stroke="#f2f0e9"
          strokeOpacity={0.7}
          strokeWidth={unit * 1.2}
        />
        <text x={view.maxE - unit * 8} y={-view.minN - unit * 11} textAnchor="end" fontSize={unit * 7} fill="#f2f0e9" fillOpacity={0.7}>
          {bar} m
        </text>
        <text x={view.minE + unit * 8} y={-view.maxN + unit * 12} fontSize={unit * 7} fontWeight={700} fill="#f2f0e9" fillOpacity={0.6}>
          N ↑
        </text>
      </g>
    </svg>
  );
}
