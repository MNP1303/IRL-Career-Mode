"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/gsap";

/** The pattern drifts at this fraction of the scroll, so it reads as further away than the content. */
const DEPTH = 0.35;
/** The tile's height as a share of its width (the mirrored tile is 3344 × 1882). */
const TILE_RATIO = 1882 / 3344;

/**
 * The app-wide pattern on its own fixed layer, moving slower than the page
 * for a sense of depth. Because the tile repeats seamlessly, the layer only
 * ever shifts by less than one tile, so it stays small however long the page.
 * One transform per scroll frame, nothing in between; static under reduced
 * motion.
 */
export function ParallaxPattern() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = layer.current;
    if (!node || prefersReducedMotion()) return;
    let tile = 0;
    let frame = 0;
    const measure = () => {
      const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pattern-size"));
      tile = size * TILE_RATIO;
    };
    const paint = () => {
      frame = 0;
      const offset = tile ? (window.scrollY * DEPTH) % tile : 0;
      node.style.transform = `translate3d(0, ${-offset}px, 0)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onResize = () => {
      measure();
      onScroll();
    };
    measure();
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={layer} aria-hidden className="brand-pattern pattern-layer" />;
}
