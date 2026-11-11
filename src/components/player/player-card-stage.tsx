"use client";

/**
 * Shows the player card as a 3D object where the device handles it well, and
 * as the existing SVG card everywhere else (no WebGL, weaker devices, or if
 * the 3D card fails). The SVG card always holds the layout, so nothing shifts
 * when the 3D card takes over, and it's what the 3D card's faces are drawn
 * from, so both always show the same card.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { PlayerCard, type PlayerCardProps } from "@/components/player/player-card";
import { rasterizeCard } from "@/components/player/card-texture";
import { WebGLBoundary, prefersLiteRendering, supportsWebGL } from "@/components/three/capabilities";
import { ATTRIBUTE_KEYS, ATTRIBUTES, POSITION_META, type Position } from "@/lib/domain";
import { overallFor } from "@/lib/engine/progression";
import { cn } from "@/lib/utils";

const PlayerCard3D = dynamic(() => import("@/components/player/player-card-3d"), { ssr: false });

const OVR_KEY = "irl-career-mode:card-ovr";

/** True once per rise in the overall, so the 3D card can celebrate it. */
function useRatingRise(ovr: number) {
  const [rose] = useState(() => {
    try {
      const previous = Number(sessionStorage.getItem(OVR_KEY));
      return Number.isFinite(previous) && previous > 0 && ovr > previous;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(OVR_KEY, String(ovr));
    } catch {
      // Only the celebration depends on this.
    }
  }, [ovr]);
  return rose;
}

export function PlayerCardStage(props: PlayerCardProps) {
  const { profile, attributes, level, demo, className } = props;
  const [webgl] = useState(supportsWebGL);
  const [lite] = useState(prefersLiteRendering);
  const [failed, setFailed] = useState(false);
  const [faces, setFaces] = useState<{ front: HTMLCanvasElement; back: HTMLCanvasElement } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const source = useRef<HTMLDivElement>(null);
  const use3d = webgl && !lite && !failed;

  const position = (profile.positions[0] ?? "CM") as Position;
  const ovr = overallFor(attributes, position);
  const celebrate = useRatingRise(ovr);
  const signature = JSON.stringify([profile, ATTRIBUTE_KEYS.map((key) => Math.round(attributes[key])), level, demo]);

  // Redraw the faces whenever anything printed on the card changes.
  useEffect(() => {
    if (!use3d || !source.current) return;
    let cancelled = false;
    const root = source.current;
    // Give the hidden card a frame to render its art.
    const frame = requestAnimationFrame(() => {
      rasterizeCard(root, 3)
        .then((next) => {
          if (!cancelled) setFaces(next);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [use3d, signature]);

  if (!use3d) return <PlayerCard {...props} />;

  const ready = Boolean(faces);
  const label = `${profile.name}, ${ovr} overall, ${POSITION_META[position].name}, level ${level}. ${ATTRIBUTE_KEYS.map(
    (key) => `${ATTRIBUTES[key].name} ${Math.round(attributes[key])}`,
  ).join(", ")}.`;

  return (
    <div className={cn("relative mx-auto w-full max-w-[340px]", className)}>
      {/* The finished card art the 3D faces are drawn from, out of sight. */}
      <div ref={source} aria-hidden inert className="pointer-events-none fixed top-0 left-[-10000px] w-[320px]">
        <PlayerCard {...props} still interactive={false} className="max-w-[320px]" />
      </div>

      {/* The SVG card holds the space, and shows until the 3D card is ready. */}
      <div aria-hidden={ready || undefined} inert={ready || undefined} className={cn("transition-opacity duration-500", ready && "opacity-0")}>
        <PlayerCard {...props} className="max-w-none" />
      </div>

      {faces ? (
        <div className="absolute -inset-x-[12%] -inset-y-[7%] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700">
          <WebGLBoundary onError={() => setFailed(true)}>
            <PlayerCard3D
              front={faces.front}
              back={faces.back}
              flipped={flipped}
              celebrate={celebrate}
              lite={lite}
              label={flipped ? `Back of the card. ${label}` : label}
              onToggle={() => setFlipped((current) => !current)}
              onContextLost={() => setFailed(true)}
            />
          </WebGLBoundary>
        </div>
      ) : null}

      {ready ? (
        <button
          type="button"
          aria-pressed={flipped}
          aria-label={flipped ? "Show the front of the player card" : "Show the back of the player card"}
          onClick={() => setFlipped((current) => !current)}
          className="absolute right-0 bottom-0 z-10 grid size-9 place-items-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition-[color,transform] duration-(--dur-hover) outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <RotateCw className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
