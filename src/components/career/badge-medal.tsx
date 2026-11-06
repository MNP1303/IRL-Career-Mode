import {
  CalendarDays,
  Crown,
  Flag,
  Flame,
  Goal,
  Grid2x2,
  Medal,
  Route,
  Shield,
  Shuffle,
  Star,
  Timer,
  Trophy,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BadgeIcon, BadgeRarity } from "@/lib/engine/achievements";
import { cn } from "@/lib/utils";

const ICONS: Record<BadgeIcon, LucideIcon> = {
  whistle: Flag,
  goal: Goal,
  assist: Route,
  hattrick: Crown,
  playmaker: Wand2,
  motm: Medal,
  form: Flame,
  shield: Shield,
  streak: Zap,
  clock: Timer,
  formats: Grid2x2,
  versatile: Shuffle,
  calendar: CalendarDays,
  star: Star,
  trophy: Trophy,
};

const RARITY: Record<BadgeRarity, { label: string; rim: string; fill: string; ink: string }> = {
  common: { label: "Common", rim: "#aab5ad", fill: "#222a24", ink: "#dfe6e1" },
  rare: { label: "Rare", rim: "#c8ff00", fill: "#1d2a10", ink: "#c8ff00" },
  epic: { label: "Epic", rim: "#ffe27a", fill: "#c8ff00", ink: "#111111" },
};

export const rarityLabel = (rarity: BadgeRarity) => RARITY[rarity].label;

export function BadgeMedal({
  icon,
  rarity,
  locked,
  className,
}: {
  icon: BadgeIcon;
  rarity: BadgeRarity;
  locked?: boolean;
  className?: string;
}) {
  const Icon = ICONS[icon];
  const tone = locked
    ? { rim: "#39423b", fill: "#141915", ink: "#66716a" }
    : RARITY[rarity];

  return (
    <span className={cn("relative grid size-14 shrink-0 place-items-center", className)}>
      <svg viewBox="0 0 56 60" className="absolute inset-0 size-full" aria-hidden>
        <path
          d="M28 2 52 12V34C52 45 42 53 28 58 14 53 4 45 4 34V12Z"
          fill={tone.fill}
          stroke={tone.rim}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <Icon className="relative -mt-0.5 size-[42%]" style={{ color: tone.ink }} strokeWidth={2.2} />
    </span>
  );
}
