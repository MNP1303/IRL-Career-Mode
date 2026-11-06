"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/gsap";

type Ripple = { id: number; x: number; y: number };

/**
 * The click state of the cursor: a soft ring spreads from the pointer and
 * fades. The real cursor stays visible throughout, so nothing about pointing
 * changes. Mouse only, not in text fields, and never under reduced motion.
 */
export function CursorRipple() {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0 || !fine.matches || prefersReducedMotion()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true'], :disabled")) return;
      const ripple = { id: event.timeStamp, x: event.clientX, y: event.clientY };
      setRipples((current) => [...current.slice(-3), ripple]);
    };
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);

  return ripples.map((ripple) => (
    <span
      key={ripple.id}
      aria-hidden
      className="cursor-ripple"
      style={{ translate: `${ripple.x}px ${ripple.y}px` }}
      onAnimationEnd={() => setRipples((current) => current.filter((item) => item.id !== ripple.id))}
    />
  ));
}
