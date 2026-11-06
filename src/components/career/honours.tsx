"use client";

import Link from "next/link";
import { ArrowUpRight, Sparkles, Star } from "lucide-react";
import { useRef } from "react";
import { BadgeMedal, rarityLabel } from "@/components/career/badge-medal";
import { FillBar } from "@/components/shared/primitives";
import { EASE, ScrollTrigger, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import type { AchievementState, Milestone } from "@/lib/engine/career";
import { formatDate } from "@/lib/stats";
import { cn } from "@/lib/utils";

const FORMATTED_TARGET = new Intl.NumberFormat("en-GB");

export function ObjectiveRow({ entry }: { entry: AchievementState }) {
  const { def, current } = entry;
  const share = Math.min(1, current / def.target);
  return (
    <li className="flex items-center gap-3">
      <BadgeMedal icon={def.icon} rarity={def.rarity} locked className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-semibold">{def.name}</p>
          <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {FORMATTED_TARGET.format(current)} / {FORMATTED_TARGET.format(def.target)}
          </p>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{def.description}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <FillBar value={share} delay={0.3} />
        </div>
      </div>
    </li>
  );
}

function AchievementCard({ entry }: { entry: AchievementState }) {
  const { def, current, unlockedOn } = entry;
  const unlocked = Boolean(unlockedOn);
  return (
    <li
      data-badge
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3",
        unlocked ? "border-border bg-accent/50" : "border-dashed border-border",
      )}
    >
      <span data-medal={unlocked ? "unlocked" : "locked"} className="shrink-0">
        <BadgeMedal icon={def.icon} rarity={def.rarity} locked={!unlocked} />
      </span>
      <div className="min-w-0">
        <p className={cn("heading text-sm", !unlocked && "text-muted-foreground")}>{def.name}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{def.description}</p>
        <p className="eyebrow mt-1.5">
          {rarityLabel(def.rarity)}
          {unlockedOn
            ? ` · ${formatDate(unlockedOn)}`
            : ` · ${FORMATTED_TARGET.format(current)} / ${FORMATTED_TARGET.format(def.target)}`}
        </p>
      </div>
    </li>
  );
}

export function AchievementGrid({ achievements }: { achievements: AchievementState[] }) {
  const unlocked = achievements
    .filter((entry) => entry.unlockedOn)
    .sort((a, b) => b.unlockedOn!.localeCompare(a.unlockedOn!));
  const locked = achievements
    .filter((entry) => !entry.unlockedOn)
    .sort((a, b) => b.current / b.def.target - a.current / a.def.target);
  const grid = useRef<HTMLUListElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const cards = gsap.utils.toArray<HTMLElement>("[data-badge]");
      gsap.set(cards, { opacity: 0, y: 16 });
      // Cards arrive in rows as they scroll into view; earned medals land with a small pop.
      ScrollTrigger.batch(cards, {
        start: "top bottom",
        once: true,
        onEnter: (batch) => {
          gsap.to(batch, { opacity: 1, y: 0, duration: 0.5, ease: EASE.out, stagger: 0.05, clearProps: "opacity,transform" });
          const medals = batch.flatMap((card) => [...card.querySelectorAll('[data-medal="unlocked"]')]);
          gsap.from(medals, { scale: 0.55, rotate: -12, duration: 0.6, ease: EASE.pop, stagger: 0.05, delay: 0.1 });
        },
      });
    },
    { scope: grid },
  );

  return (
    <ul ref={grid} className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {[...unlocked, ...locked].map((entry) => (
        <AchievementCard key={entry.def.id} entry={entry} />
      ))}
    </ul>
  );
}

function milestoneCopy(milestone: Milestone) {
  if (milestone.kind === "badge") {
    return { title: milestone.badge.name, detail: milestone.badge.description };
  }
  if (milestone.kind === "level") {
    return { title: `Reached level ${milestone.level}`, detail: "Earned through logged XP" };
  }
  return { title: `Reached ${milestone.ovr} OVR`, detail: "New career-high rating band" };
}

export function MilestoneTimeline({ milestones, limit }: { milestones: Milestone[]; limit?: number }) {
  const shown = limit ? milestones.slice(0, limit) : milestones;
  return (
    <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[19px] before:w-px before:bg-border">
      {shown.map((milestone, index) => {
        const { title, detail } = milestoneCopy(milestone);
        return (
          <li key={`${milestone.kind}-${milestone.matchId}-${index}`}>
            <Link
              href={`/matches/${milestone.matchId}`}
              className="group relative flex items-center gap-3 rounded-md py-1.5 pr-2 outline-none transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
            >
              <span className="relative grid size-10 shrink-0 place-items-center">
                {milestone.kind === "badge" ? (
                  <BadgeMedal icon={milestone.badge.icon} rarity={milestone.badge.rarity} className="size-9" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-full bg-card ring-1 ring-primary/40">
                    {milestone.kind === "level" ? (
                      <Sparkles className="size-3.5 text-primary" />
                    ) : (
                      <Star className="size-3.5 text-primary" />
                    )}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(milestone.date)}</span>
              <ArrowUpRight className="hidden size-3.5 shrink-0 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:block" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
