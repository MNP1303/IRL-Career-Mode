"use client";

/**
 * The card brought up close: the same 3D card lifts out of its place on the
 * page and travels to the centre while the page dims and blurs behind it,
 * then it can be dragged round or turned over. Closing sends it back to the
 * exact spot it came from. The flight starts only once the inspector's card
 * has drawn, so one card appears to move rather than one swapping for
 * another. Under reduced motion it simply fades in and out.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { RotateCw, X } from "lucide-react";
import PlayerCard3D, { CARD_FILL } from "@/components/player/player-card-3d";
import type { CardFaces } from "@/components/player/card-texture";
import { WebGLBoundary } from "@/components/three/capabilities";
import { POSITION_META, type Position } from "@/lib/domain";
import type { CardTierId } from "@/lib/engine/rules";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";

const control =
  "inline-flex h-10 items-center gap-2 rounded-full border border-foreground/15 bg-background/60 px-4 text-sm font-medium text-foreground/85 backdrop-blur transition-[color,background-color,border-color,transform] duration-(--dur-hover) outline-none hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]";

export default function CardInspector({
  faces,
  tier,
  tierName,
  accent,
  lite,
  label,
  name,
  ovr,
  position,
  level,
  flipped,
  onFlip,
  source,
  onHandOver,
  onClosed,
  onContextLost,
}: {
  faces: CardFaces;
  tier: CardTierId;
  tierName: string;
  accent: string;
  lite: boolean;
  label: string;
  name: string;
  ovr: number;
  position: Position;
  level: number;
  flipped: boolean;
  onFlip: (flipped: boolean) => void;
  /** The card on the page, where the flight starts and ends. */
  source: HTMLElement | null;
  /** True while this card stands in for the one on the page. */
  onHandOver: (handedOver: boolean) => void;
  onClosed: () => void;
  onContextLost: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [stage, setStageState] = useState<HTMLDivElement | null>(null);
  // The stage as a ref too, for the flight callbacks (which may be called before a re-render).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const setStage = useCallback((node: HTMLDivElement | null) => {
    stageRef.current = node;
    setStageState(node);
  }, []);
  const backdrop = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const closing = useRef(false);
  const reduced = prefersReducedMotion();

  /** How to place the stage so its card sits exactly over the card on the page. */
  const fromSource = useCallback(() => {
    const stage = stageRef.current;
    const from = source?.getBoundingClientRect();
    if (!from || !stage) return { x: 0, y: 0, scale: 1 };
    const to = stage.getBoundingClientRect();
    // Measured without any transform the flight has applied.
    const current = (gsap.getProperty(stage, "scale") as number) || 1;
    // The stage frames the card as the page does: the card fills CARD_FILL of its height.
    const cardHeight = (to.height / current) * CARD_FILL;
    const centreX = to.left + to.width / 2;
    const centreY = to.top + to.height / 2;
    return {
      x: from.left + from.width / 2 - centreX + ((gsap.getProperty(stage, "x") as number) || 0),
      y: from.top + from.height / 2 - centreY + ((gsap.getProperty(stage, "y") as number) || 0),
      scale: from.height / cardHeight || 1,
    };
  }, [source]);

  // Until the inspector's card has drawn, it waits invisibly over the page's card.
  useLayoutEffect(() => {
    if (!stage || reduced) return;
    gsap.set(stage, { ...fromSource(), opacity: 0 });
    gsap.set(caption.current, { opacity: 0, y: 12 });
    gsap.set(backdrop.current, { opacity: 0 });
  }, [stage, reduced, fromSource]);

  const arrive = useCallback(() => {
    const stage = stageRef.current;
    // Closed before its card had even drawn: the page's card never left.
    if (closing.current) return;
    onHandOver(true);
    if (reduced || !stage) {
      gsap.fromTo([stage, backdrop.current, caption.current], { opacity: 0 }, { opacity: 1, duration: 0.25 });
      return;
    }
    timeline.current?.kill();
    timeline.current = gsap
      .timeline()
      .set(stage, { opacity: 1 })
      .to(backdrop.current, { opacity: 1, duration: 0.5, ease: EASE.out }, 0)
      .to(stage, { x: 0, y: 0, scale: 1, duration: 0.85, ease: "expo.inOut" }, 0)
      .to(caption.current, { opacity: 1, y: 0, duration: 0.5, ease: EASE.out }, 0.45);
  }, [onHandOver, reduced]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const stage = stageRef.current;
    timeline.current?.kill();
    const finish = () => {
      onHandOver(false);
      setOpen(false);
      onClosed();
    };
    if (reduced || !stage) {
      gsap.to([stage, backdrop.current, caption.current], { opacity: 0, duration: 0.2, onComplete: finish });
      return;
    }
    timeline.current = gsap
      .timeline({ onComplete: finish })
      .to(caption.current, { opacity: 0, y: 8, duration: 0.2, ease: EASE.out }, 0)
      .to(stage, { ...fromSource(), duration: 0.7, ease: "expo.inOut" }, 0)
      .to(backdrop.current, { opacity: 0, duration: 0.45, ease: EASE.inOut }, 0.25);
  }, [fromSource, onClosed, onHandOver, reduced]);

  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          ref={backdrop}
          className="fixed inset-0 z-[60] bg-[#060707]/80 backdrop-blur-md"
        />
        <DialogPrimitive.Popup
          // A click on the empty space around the card closes it, as on a backdrop.
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 px-gutter outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Player card: {name}</DialogPrimitive.Title>
          <div
            ref={setStage}
            className="relative aspect-[512/642] h-[min(76dvh,112vw)] cursor-grab touch-none select-none will-change-transform active:cursor-grabbing"
          >
            <WebGLBoundary onError={onContextLost}>
              <PlayerCard3D
                faces={faces}
                tier={tier}
                accent={accent}
                flipped={flipped}
                celebrate={false}
                focus
                inspect
                lite={lite}
                label={flipped ? `Back of the card. ${label}` : label}
                surface={stage}
                onToggle={() => onFlip(!flipped)}
                onSettle={onFlip}
                onFirstFrame={arrive}
                onContextLost={onContextLost}
              />
            </WebGLBoundary>
          </div>

          <div ref={caption} className="flex flex-col items-center gap-4 text-center">
            <div>
              <p className="display text-2xl leading-none">{name}</p>
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                {ovr} OVR · {POSITION_META[position].name} · {tierName} · Level {level}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onFlip(!flipped)} aria-pressed={flipped} className={control}>
                <RotateCw className="size-4" />
                {flipped ? "Show front" : "Show back"}
              </button>
              <DialogPrimitive.Close className={control} aria-label="Close the card">
                <X className="size-4" />
                Close
              </DialogPrimitive.Close>
            </div>
            <p className="text-label text-faint">{touch ? "Drag to turn · Tap to flip" : "Drag to turn · Click to flip"}</p>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
