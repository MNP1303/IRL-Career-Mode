"use client";

/**
 * Shows the player card as a 3D object where the device handles it well, and
 * as the existing SVG card everywhere else (no WebGL, weaker devices, or if
 * the 3D card fails). The SVG card always holds the layout, so nothing shifts
 * when the 3D card takes over, and it's what the 3D card's faces are drawn
 * from, so both always show the same card. Selecting the 3D card opens the
 * inspector, where it can be turned over and looked at closely.
 */

import dynamic from "next/dynamic";
import { ViewTransition, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, RotateCw } from "lucide-react";
import { PlayerCard, TIER_FOIL, type PlayerCardProps } from "@/components/player/player-card";
import { rasterizeCard, type CardFaces } from "@/components/player/card-texture";
import { WebGLBoundary, prefersLiteRendering, supportsWebGL } from "@/components/three/capabilities";
import { ATTRIBUTE_KEYS, ATTRIBUTES, POSITION_META, type Position } from "@/lib/domain";
import { cardTierFor, overallFor } from "@/lib/engine/progression";
import { cn } from "@/lib/utils";

const PlayerCard3D = dynamic(() => import("@/components/player/player-card-3d"), { ssr: false });
const CardInspector = dynamic(() => import("@/components/player/player-card-inspector"), { ssr: false });

const OVR_KEY = "irl-career-mode:card-ovr";

/**
 * Drawn faces by card content. Coming back to a page shows the 3D card
 * straight away instead of redrawing it, and the hub and player page share it.
 */
const drawnFaces = new Map<string, CardFaces>();
function remember(signature: string, faces: CardFaces) {
  drawnFaces.delete(signature);
  drawnFaces.set(signature, faces);
  // Live editing on the player page draws a new card per change; keep only the latest few.
  while (drawnFaces.size > 4) drawnFaces.delete(drawnFaces.keys().next().value!);
}

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

/**
 * The card keeps one identity across pages: going from the hub to the player
 * page it travels to its new place (a shared-element view transition), and to
 * or from a page without it, it recedes into or rises out of the distance.
 */
function CardPresence({ children }: { children: ReactNode }) {
  return (
    <ViewTransition name="player-card" share="card-morph" enter="card-rise" exit="card-recede" default="none">
      {children}
    </ViewTransition>
  );
}

const iconButton =
  "grid size-9 place-items-center rounded-full border border-border bg-background/80 text-muted-foreground backdrop-blur transition-[color,transform,border-color] duration-(--dur-hover) outline-none hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95";

export function PlayerCardStage(props: PlayerCardProps) {
  const { profile, attributes, level, demo, className } = props;
  const [webgl] = useState(supportsWebGL);
  const [lite] = useState(prefersLiteRendering);
  const [failed, setFailed] = useState(false);
  const use3d = webgl && !lite && !failed;

  const position = (profile.positions[0] ?? "CM") as Position;
  const ovr = overallFor(attributes, position);
  const tier = cardTierFor(ovr);
  const accent = TIER_FOIL[tier.id].accent;
  const celebrate = useRatingRise(ovr);
  const signature = JSON.stringify([profile, ATTRIBUTE_KEYS.map((key) => Math.round(attributes[key])), level, demo]);

  const [faces, setFaces] = useState<CardFaces | null>(() => drawnFaces.get(signature) ?? null);
  // A card already drawn this session is coming back into view: no entrance, just the card.
  const [returning] = useState(() => drawnFaces.size > 0);
  const [drawn, setDrawn] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  /** True while the inspector's card stands in for this one. */
  const [handedOver, setHandedOver] = useState(false);
  const [surface, setSurface] = useState<HTMLButtonElement | null>(null);
  const source = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);

  // Redraw the faces whenever anything printed on the card changes.
  useEffect(() => {
    if (!use3d || !source.current) return;
    if (drawnFaces.has(signature)) return;
    let cancelled = false;
    const root = source.current;
    // Give the hidden card a frame to render its art; while typing, wait for a pause.
    const timer = window.setTimeout(
      () =>
        requestAnimationFrame(() => {
          rasterizeCard(root, 3)
            .then((next) => {
              remember(signature, next);
              if (!cancelled) setFaces(next);
            })
            .catch(() => {
              if (!cancelled) setFailed(true);
            });
        }),
      faces ? 160 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Only new content should trigger a redraw, not the faces it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3d, signature]);

  const toggle = useCallback(() => setFlipped((current) => !current), []);
  const markDrawn = useCallback(() => setDrawn(true), []);

  if (!use3d)
    return (
      <CardPresence>
        <PlayerCard {...props} />
      </CardPresence>
    );

  // Already-drawn content shows at once; otherwise the last drawing stays up until the new one is ready.
  const shown = drawnFaces.get(signature) ?? faces;

  const label = `${profile.name}, ${ovr} overall, ${POSITION_META[position].name}, level ${level}. ${ATTRIBUTE_KEYS.map(
    (key) => `${ATTRIBUTES[key].name} ${Math.round(attributes[key])}`,
  ).join(", ")}.`;

  return (
    <>
      {/* The finished card art the 3D faces are drawn from, out of sight (and outside the transition's snapshot). */}
      <div ref={source} aria-hidden inert className="pointer-events-none fixed top-0 left-[-10000px] w-[320px]">
        <PlayerCard {...props} still interactive={false} className="max-w-[320px]" />
      </div>
      <CardPresence>
        <div ref={setBox} className={cn("relative mx-auto w-full max-w-[340px]", className)}>
          {/* The SVG card holds the space and shows until the 3D card has drawn, then fades out beneath it. */}
          <div
            aria-hidden={drawn || undefined}
            inert={drawn || undefined}
            className={cn("transition-opacity delay-300 duration-300", drawn && "opacity-0")}
          >
            <PlayerCard {...props} intro={!returning} className="max-w-none" />
          </div>

          {shown ? (
            <div
              className={cn(
                // Wider and taller than the card, so its halo and shadow have room to fade out.
                "pointer-events-none absolute -inset-x-[18%] -inset-y-[18%] transition-opacity duration-300 sm:-inset-x-[30%]",
                (!drawn || handedOver) && "opacity-0",
                handedOver && "duration-0",
              )}
            >
              <WebGLBoundary onError={() => setFailed(true)}>
                <PlayerCard3D
                  faces={shown}
                  tier={tier.id}
                  accent={accent}
                  flipped={flipped}
                  celebrate={celebrate}
                  lite={lite}
                  label={flipped ? `Back of the card. ${label}` : label}
                  surface={surface}
                  onToggle={toggle}
                  onFirstFrame={markDrawn}
                  onContextLost={() => setFailed(true)}
                />
              </WebGLBoundary>
            </div>
          ) : null}

          {drawn && shown ? (
            <>
              {/* The card itself: point at it to tilt it, select it to inspect it. */}
              <button
                ref={setSurface}
                type="button"
                aria-label={`Inspect the player card. ${label}`}
                aria-haspopup="dialog"
                onClick={() => setInspecting(true)}
                className="absolute inset-0 z-[1] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
              />
              <div className="absolute right-0 bottom-0 z-10 flex gap-2">
                <button
                  type="button"
                  aria-label="Inspect the player card"
                  aria-haspopup="dialog"
                  onClick={() => setInspecting(true)}
                  className={iconButton}
                >
                  <Maximize2 className="size-4" />
                </button>
                <button
                  type="button"
                  aria-pressed={flipped}
                  aria-label={flipped ? "Show the front of the player card" : "Show the back of the player card"}
                  onClick={toggle}
                  className={iconButton}
                >
                  <RotateCw className="size-4" />
                </button>
              </div>
            </>
          ) : null}

          {inspecting && shown ? (
            <CardInspector
              faces={shown}
              tier={tier.id}
              tierName={tier.name}
              accent={accent}
              lite={lite}
              label={label}
              name={profile.name}
              ovr={ovr}
              position={position}
              level={level}
              flipped={flipped}
              onFlip={setFlipped}
              source={box}
              onHandOver={setHandedOver}
              onClosed={() => {
                setHandedOver(false);
                setInspecting(false);
              }}
              onContextLost={() => setFailed(true)}
            />
          ) : null}
        </div>
      </CardPresence>
    </>
  );
}
