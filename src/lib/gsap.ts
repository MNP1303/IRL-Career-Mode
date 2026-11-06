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

/** One small vocabulary of motion, so every screen moves the same way. */
export const EASE = {
  /** Entrances and most UI movement. */
  out: "power3.out",
  /** Numbers and fills that settle on a value. */
  settle: "expo.out",
  /** Small pops for badges and markers. */
  pop: "back.out(2)",
  /** Camera moves and exits. */
  inOut: "power2.inOut",
} as const;

/** Durations in seconds, matching the --dur-* tokens in globals.css. */
export const DURATION = {
  press: 0.12,
  hover: 0.2,
  exit: 0.16,
  enter: 0.28,
  move: 0.42,
} as const;

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { gsap, ScrollTrigger, useGSAP };
