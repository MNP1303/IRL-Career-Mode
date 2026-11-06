"use client";

import { useMemo, useRef } from "react";
import { FillBar } from "@/components/shared/primitives";
import { PITCH } from "@/lib/domain";
import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { renderHeatmap, zoneShares, type ZoneGrid } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

export function HeatLayer({ grid }: { grid: ZoneGrid }) {
  const image = useMemo(() => renderHeatmap(grid), [grid]);
  const node = useRef<SVGImageElement>(null);

  useGSAP(
    () => {
      if (!image || prefersReducedMotion()) return;
      gsap.fromTo(node.current, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power1.out" });
    },
    { dependencies: [image] },
  );

  if (!image) return null;
  return <image ref={node} href={image} width={PITCH.length} height={PITCH.width} preserveAspectRatio="none" />;
}

export function HeatLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span>Less</span>
      <span
        aria-hidden
        className="h-2 w-24 rounded-full"
        style={{ background: "linear-gradient(90deg, #17331b, #5a9618, #96d71e, #c8ff00, #f4ffd6)" }}
      />
      <span>More active</span>
    </div>
  );
}

function ShareBars({ title, items }: { title: string; items: { label: string; share: number }[] }) {
  return (
    <div>
      <h3 className="eyebrow mb-2.5">{title}</h3>
      <dl className="space-y-2.5">
        {items.map((item) => (
          <div key={item.label} className="grid grid-cols-[6.75rem_1fr_2.5rem] items-center gap-2 text-sm">
            <dt className="truncate text-muted-foreground">{item.label}</dt>
            <div className="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
              <FillBar value={item.share} />
            </div>
            <dd className="text-right font-medium tabular-nums">{Math.round(item.share * 100)}%</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ZoneBreakdown({ grid, className }: { grid: ZoneGrid; className?: string }) {
  const shares = useMemo(() => zoneShares(grid), [grid]);
  return (
    <div className={cn("space-y-6", className)}>
      <ShareBars title="Pitch thirds" items={shares.thirds} />
      <ShareBars title="Channels" items={shares.channels} />
    </div>
  );
}
