"use client";

/**
 * The 2D tactical view of a GPS heatmap: the calibrated pitch drawn at its
 * true proportions (a 40 × 20 m five-a-side pitch is not stretched to look
 * like a full-size one), with the density grid painted over it. Only lines
 * every pitch has are drawn (touchlines, halfway line, centre mark), since a
 * custom pitch's box sizes aren't known.
 */

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import type { PreviewPoint } from "@/lib/gps/pipeline";
import type { DrawableGrid } from "@/lib/gps/record";
import { HEAT_LEGEND_GRADIENT, paintHeat } from "@/lib/gps/render";
import type { PitchDimensions } from "@/lib/gps/types";
import { cn } from "@/lib/utils";

const MARGIN = 6;
const LINE = { stroke: "#fff", strokeOpacity: 0.7, fill: "none" } as const;
const PLACEMENT_FILL = { in: "#f2f0e9", near: "#f5c542", off: "#ff5f52" } as const;

function useHeatImage(grid: DrawableGrid | null | undefined, pitch: PitchDimensions) {
  return useMemo(() => {
    if (!grid || typeof document === "undefined") return null;
    const spanX = pitch.length + MARGIN * 2;
    const spanY = pitch.width + MARGIN * 2;
    const scale = Math.min(6, 720 / spanX);
    const width = Math.round(spanX * scale);
    const height = Math.round(spanY * scale);
    const pixels = paintHeat(grid, width, height, (u, v) => ({ x: -MARGIN + u * spanX, y: -MARGIN + v * spanY }));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    return canvas.toDataURL("image/png");
  }, [grid, pitch.length, pitch.width]);
}

export function GpsPitch({
  grid,
  pitch,
  points,
  label,
  className,
}: {
  grid?: DrawableGrid | null;
  pitch: PitchDimensions;
  points?: PreviewPoint[];
  label: string;
  className?: string;
}) {
  const image = useHeatImage(grid, pitch);
  const { length: L, width: W } = pitch;
  const scale = Math.min(1, L / 105, W / 68);
  const stroke = Math.max(0.12, 0.26 * Math.sqrt(scale));
  const stripes = Math.max(6, Math.round(L / 7.5));

  return (
    <svg
      viewBox={`${-MARGIN} ${-MARGIN} ${L + MARGIN * 2} ${W + MARGIN * 2}`}
      role="img"
      aria-label={label}
      className={cn("block w-full select-none", className)}
    >
      <rect x={-MARGIN} y={-MARGIN} width={L + MARGIN * 2} height={W + MARGIN * 2} rx={1.5} fill="#0a1f12" />
      <rect width={L} height={W} fill="#0f2c19" />
      {Array.from({ length: stripes }, (_, index) =>
        index % 2 === 0 ? <rect key={index} x={(index * L) / stripes} width={L / stripes} height={W} fill="#123520" /> : null,
      )}
      {image ? (
        <image href={image} x={-MARGIN} y={-MARGIN} width={L + MARGIN * 2} height={W + MARGIN * 2} preserveAspectRatio="none" />
      ) : null}
      <g strokeWidth={stroke} {...LINE}>
        <rect width={L} height={W} />
        <line x1={L / 2} x2={L / 2} y1={0} y2={W} />
        <circle cx={L / 2} cy={W / 2} r={Math.min(9.15, W * 0.15)} />
      </g>
      <circle cx={L / 2} cy={W / 2} r={stroke * 1.4} fill="#fff" fillOpacity={0.8} />
      {points?.length ? (
        <g aria-hidden>
          {points.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r={Math.max(0.25, 0.4 * scale)} fill={PLACEMENT_FILL[point.placement]} fillOpacity={point.placement === "in" ? 0.55 : 0.9} />
          ))}
        </g>
      ) : null}
      <text x={L - 1} y={W + MARGIN - 1.6} textAnchor="end" fontSize={Math.max(1.6, 2.4 * scale)} fill="#f2f0e9" fillOpacity={0.6}>
        {L} × {W} m
      </text>
    </svg>
  );
}

export function GpsHeatLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-2">
        <span>Less time</span>
        <span aria-hidden className="h-2 w-24 rounded-full" style={{ background: HEAT_LEGEND_GRADIENT }} />
        <span>More time</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        Attacking <ArrowRight className="size-3.5 text-primary" aria-label="to the right" />
      </span>
    </div>
  );
}

export function PlacementLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full" style={{ background: PLACEMENT_FILL.in }} /> On the pitch
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full" style={{ background: PLACEMENT_FILL.near }} /> Just outside (counted)
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 rounded-full" style={{ background: PLACEMENT_FILL.off }} /> Too far out (left out)
      </li>
    </ul>
  );
}
