"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { EASE, gsap, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/utils";

/**
 * Leans its content towards the pointer in 3D, with a soft highlight that
 * follows like light catching the surface. Mouse and trackpad only; on touch
 * or with reduced motion it renders flat. Driven by GSAP quickTo, so it costs
 * nothing until the pointer moves over it.
 */
export function Tilt({
  children,
  max = 5,
  radius = "rounded-xl",
  className,
}: {
  children: ReactNode;
  /** Largest lean in degrees. */
  max?: number;
  /** Corner radius class matching the content, so the highlight fits it. */
  radius?: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = root.current;
    const plate = layer.current;
    const light = glare.current;
    if (!element || !plate || !light) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || prefersReducedMotion()) return;

    gsap.set(plate, { transformPerspective: 900, transformOrigin: "50% 50%" });
    const rotateX = gsap.quickTo(plate, "rotationX", { duration: 0.5, ease: EASE.out });
    const rotateY = gsap.quickTo(plate, "rotationY", { duration: 0.5, ease: EASE.out });

    const move = (event: PointerEvent) => {
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      rotateY((x - 0.5) * 2 * max);
      rotateX(-(y - 0.5) * 2 * max);
      light.style.setProperty("--glare-x", `${x * 100}%`);
      light.style.setProperty("--glare-y", `${y * 100}%`);
      light.style.opacity = "1";
    };
    const leave = () => {
      rotateX(0);
      rotateY(0);
      light.style.opacity = "0";
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", leave);
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(plate);
      gsap.set(plate, { clearProps: "transform" });
    };
  }, [max]);

  return (
    <div ref={root} className={className}>
      <div ref={layer} className="relative [transform-style:preserve-3d]">
        {children}
        <span ref={glare} aria-hidden className={cn("tilt-glare", radius)} />
      </div>
    </div>
  );
}
