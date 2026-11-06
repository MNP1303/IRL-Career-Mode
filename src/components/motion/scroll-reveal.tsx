"use client";

import { useRef, type ReactNode } from "react";
import { DURATION, EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";

/**
 * Rises into place the first time it scrolls into view, for content further
 * down long pages. Anything already on screen shows straight away, and under
 * reduced motion it's simply there.
 */
export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !ref.current) return;
      gsap.from(ref.current, {
        opacity: 0,
        y: 20,
        duration: DURATION.move + 0.1,
        ease: EASE.out,
        clearProps: "opacity,transform",
        scrollTrigger: { trigger: ref.current, start: "top bottom", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
