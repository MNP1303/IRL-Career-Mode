"use client";

import { motion } from "motion/react";
import { POSITIONS, POSITION_META, type Position } from "@/lib/domain";
import { Pitch, uprightTransform, usePitchOrientation, type PitchOrientation } from "@/components/pitch/pitch";

function PositionNode({
  position,
  order,
  selected,
  showOrder,
  orientation,
  onToggle,
}: {
  position: Position;
  order: number;
  selected: boolean;
  showOrder: boolean;
  orientation: PitchOrientation;
  onToggle: () => void;
}) {
  const { x, y, name } = POSITION_META[position];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={name}
      className="group cursor-pointer outline-none"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <circle cx={x} cy={y} r="5.6" fill="transparent" />
      {selected ? (
        <motion.circle
          cx={x}
          cy={y}
          r="5.2"
          fill="var(--primary)"
          fillOpacity="0.2"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
      ) : null}
      <circle
        cx={x}
        cy={y}
        r="3.8"
        fill={selected ? "var(--primary)" : "#0b1c11"}
        fillOpacity={selected ? 1 : 0.86}
        stroke={selected ? "var(--primary)" : "#fff"}
        strokeOpacity={selected ? 1 : 0.42}
        strokeWidth="0.3"
        className="transition-[stroke-opacity,stroke] group-hover:stroke-[var(--primary)] group-hover:[stroke-opacity:1] group-focus-visible:stroke-[var(--primary)] group-focus-visible:[stroke-opacity:1]"
      />
      <text
        x={x}
        y={y}
        dy="0.95"
        textAnchor="middle"
        fontFamily="var(--font-montserrat)"
        fontWeight="700"
        fontSize="2.4"
        fill={selected ? "var(--primary-foreground)" : "#fff"}
        transform={uprightTransform(orientation, x, y)}
        className="pointer-events-none"
      >
        {position}
      </text>
      {selected && showOrder ? (
        <g transform={uprightTransform(orientation, x, y)}>
          <circle cx={x + 3.4} cy={y - 3.4} r="1.7" fill="#fff" />
          <text
            x={x + 3.4}
            y={y - 3.4}
            dy="0.72"
            textAnchor="middle"
            fontFamily="var(--font-montserrat)"
            fontWeight="800"
            fontSize="1.9"
            fill="#111111"
            className="pointer-events-none"
          >
            {order + 1}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** Tappable formation map. Selection order sets the primary position. */
export function PositionPicker({
  value,
  onChange,
  max = 1,
  label,
  className,
}: {
  value: Position[];
  onChange: (value: Position[]) => void;
  max?: number;
  label: string;
  className?: string;
}) {
  const orientation = usePitchOrientation();

  function toggle(position: Position) {
    if (max === 1) {
      onChange([position]);
      return;
    }
    if (value.includes(position)) {
      if (value.length > 1) onChange(value.filter((entry) => entry !== position));
      return;
    }
    onChange(value.length >= max ? [...value.slice(0, max - 1), position] : [...value, position]);
  }

  return (
    <Pitch orientation={orientation} label={label} className={className}>
      {POSITIONS.map((position) => (
        <PositionNode
          key={position}
          position={position}
          order={value.indexOf(position)}
          selected={value.includes(position)}
          showOrder={max > 1}
          orientation={orientation}
          onToggle={() => toggle(position)}
        />
      ))}
    </Pitch>
  );
}
