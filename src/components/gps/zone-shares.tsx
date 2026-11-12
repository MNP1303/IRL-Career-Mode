"use client";

import { FillBar } from "@/components/shared/primitives";
import type { ZoneShare } from "@/lib/gps/heatmap";

export function ZoneShareBars({ title, items }: { title: string; items: ZoneShare[] }) {
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
