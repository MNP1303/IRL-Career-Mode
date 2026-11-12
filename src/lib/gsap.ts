"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
  gsap.defaults({ ease: "power3.out", duration: 0.5 });
  // Timelines target optional parts (a report with no attribute changes, a row of
  // locked badges), so an empty selection is expected rather than a mistake.
  gsap.config({ nullTargetWarn: false });
}

/**
 * One small vocabulary of motion, so every screen moves the same way.
 *
 * The motion language, from smallest to largest:
 * - Micro-interactions (press, hover, focus): DURATION.press / hover, CSS
 *   transitions with --ease-out. Instant feedback, no overshoot.
 * - Content entrances: DURATION.enter / move with EASE.out, a short rise and
 *   fade, staggered a few tens of milliseconds. Played the first time a view
 *   appears in a session only (see introPlayed); coming back shows it settled.
 * - Value changes: EASE.settle, so numbers and fills land softly on the value.
 * - Changes of context (route changes, the card inspector): DURATION.scene with
 *   EASE.scene. The one shared object (the player card) travels; everything
 *   else leaves quickly and arrives gently around it.
 * - Camera moves: DURATION.camera with EASE.inOut, always interpolated, never
 *   cut, with stable end points. The first arrival may take DURATION.intro.
 * Nothing waits for an animation to become usable, and reduced motion swaps
 * every movement for an instant change or a short fade.
 */
export const EASE = {
  /** Entrances and most UI movement. */
  out: "power3.out",
  /** Numbers and fills that settle on a value. */
  settle: "expo.out",
  /** Small pops for badges and markers. */
  pop: "back.out(2)",
  /** Camera moves and exits. */
  inOut: "power2.inOut",
  /** Changes of context: a decisive start and a long, soft landing. */
  scene: "expo.inOut",
} as const;

/** Durations in seconds, matching the --dur-* tokens in globals.css. */
export const DURATION = {
  press: 0.12,
  hover: 0.2,
  exit: 0.16,
  enter: 0.28,
  move: 0.42,
  /** A change of context, such as the card travelling into the inspector. */
  scene: 0.8,
  /** A camera move between views. */
  camera: 1.1,
  /** A scene's first arrival in a session. */
  intro: 1.8,
} as const;

const played = new Set<string>();

/**
 * Entrances that aren't tied to one page (a 3D scene's arrival) run once per
 * session: check introSeen before playing, and markIntroSeen once it has
 * finished, so an interrupted entrance still gets to play next time.
 */
export function introSeen(key: string) {
  return played.has(key);
}
export function markIntroSeen(key: string) {
  played.add(key);
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { gsap, ScrollTrigger, useGSAP };
