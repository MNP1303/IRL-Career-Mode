"use client";

import { useId, useSyncExternalStore, type ReactNode, type Ref, type SVGProps } from "react";
import { ArrowRight, ArrowUp } from "lucide-react";
import { PITCH, ZONE_COLS, ZONE_ROWS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export type PitchOrientation = "landscape" | "portrait";

const PHONE_QUERY = "(max-width: 639px)";

function subscribeToViewport(listener: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** Phones get an upright pitch: far more painting area on a narrow screen. */
export function usePitchOrientation(): PitchOrientation {
  const portrait = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
  return portrait ? "portrait" : "landscape";
}

/** Keeps text upright inside the rotated portrait pitch. */
export function uprightTransform(orientation: PitchOrientation, x: number, y: number) {
  return orientation === "portrait" ? `rotate(90 ${x} ${y})` : undefined;
}

export function pointerToCell(event: { clientX: number; clientY: number }, group: SVGGElement | null) {
  const matrix = group?.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  if (point.x < 0 || point.y < 0 || point.x >= PITCH.length || point.y >= PITCH.width) return null;
  return {
    col: Math.floor((point.x / PITCH.length) * ZONE_COLS),
    row: Math.floor((point.y / PITCH.width) * ZONE_ROWS),
  };
}

const LINE = { stroke: "#fff", strokeOpacity: 0.74, strokeWidth: 0.26, fill: "none" } satisfies SVGProps<SVGElement>;

function PitchEnd({ flipped }: { flipped?: boolean }) {
  return (
    <g transform={flipped ? `translate(${PITCH.length} 0) scale(-1 1)` : undefined}>
      <rect x="0" y="13.84" width="16.5" height="40.32" {...LINE} />
      <rect x="0" y="24.84" width="5.5" height="18.32" {...LINE} />
      <circle cx="11" cy="34" r="0.3" fill="#fff" fillOpacity="0.8" />
      <path d="M16.5 26.69A9.15 9.15 0 0 1 16.5 41.31" {...LINE} />
      <rect x="-1.5" y="30.34" width="1.5" height="7.32" {...LINE} fill="#fff" fillOpacity="0.08" />
      <path d="M1 0A1 1 0 0 1 0 1M0 67A1 1 0 0 1 1 68" {...LINE} />
    </g>
  );
}

export function Pitch({
  orientation = "landscape",
  label,
  underlay,
  children,
  className,
  groupRef,
  decorative,
}: {
  orientation?: PitchOrientation;
  label: string;
  underlay?: ReactNode;
  children?: ReactNode;
  className?: string;
  groupRef?: Ref<SVGGElement>;
  /** False when children are interactive and must stay exposed to assistive tech. */
  decorative?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const portrait = orientation === "portrait";
  const stripes = 14;

  return (
    <svg
      viewBox={portrait ? "-4 -4 76 113" : "-4 -4 113 76"}
      role={decorative ? "img" : "group"}
      aria-label={label}
      className={cn("block w-full select-none", className)}
    >
      <defs>
        <radialGradient id={`flood-${uid}`} cx="0.5" cy="0.45" r="0.72">
          <stop offset="0" stopColor="#3fae57" stopOpacity="0.26" />
          <stop offset="0.6" stopColor="#1b6a33" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
      </defs>

      <rect
        x="-4"
        y="-4"
        width={portrait ? 76 : 113}
        height={portrait ? 113 : 76}
        rx="2"
        fill="#0a1f12"
      />

      <g ref={groupRef} transform={portrait ? "matrix(0 -1 1 0 0 105)" : undefined}>
        <rect width={PITCH.length} height={PITCH.width} fill="#0f2c19" />
        {Array.from({ length: stripes }, (_, index) =>
          index % 2 === 0 ? (
            <rect
              key={index}
              x={(index * PITCH.length) / stripes}
              width={PITCH.length / stripes}
              height={PITCH.width}
              fill="#123520"
            />
          ) : null,
        )}
        <rect width={PITCH.length} height={PITCH.width} fill={`url(#flood-${uid})`} />

        {underlay}

        <g>
          <rect width={PITCH.length} height={PITCH.width} {...LINE} strokeWidth={0.34} />
          <line x1="52.5" x2="52.5" y1="0" y2="68" {...LINE} />
          <circle cx="52.5" cy="34" r="9.15" {...LINE} />
          <circle cx="52.5" cy="34" r="0.34" fill="#fff" fillOpacity="0.8" />
          <PitchEnd />
          <PitchEnd flipped />
        </g>

        {children}
      </g>
    </svg>
  );
}

export function AttackHint({ orientation, className }: { orientation: PitchOrientation; className?: string }) {
  const Icon = orientation === "portrait" ? ArrowUp : ArrowRight;
  return (
    <span className={cn("eyebrow inline-flex items-center gap-1.5", className)}>
      Attacking <Icon className="size-3.5 text-primary" />
    </span>
  );
}
