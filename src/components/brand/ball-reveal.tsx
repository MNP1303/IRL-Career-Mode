"use client";

import { useId, type CSSProperties } from "react";
import ballImage from "@/assets/brand/formation-ball.webp";
import lightsImage from "@/assets/brand/formation-lights.webp";
import { cn } from "@/lib/utils";

const ARC = "M85.5 234.9 A250 250 0 0 1 -246.2 -43.4";

/**
 * The football-formation animation: golden light traces the seams, then the
 * ball fades in. A faithful port of the supplied "Ball reveal" design. The
 * 800px artboard is drawn in `em` so it scales to `size` without
 * redrawing; its keyframes live in globals.css.
 */
export function BallReveal({
  size = "min(62vw, 42vh, 340px)",
  duration = 7,
  delay = "0s",
  className,
}: {
  /** Any CSS length for the artboard's width and height. */
  size?: string;
  /** Seconds per loop; the design's own default is 7. */
  duration?: number;
  /** Holds the animation back, so a loader that fades in late still shows the whole formation. */
  delay?: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <div
      className={cn("br-root", className)}
      style={{ "--br-size": size, "--br-d": `${duration}s`, "--br-delay": delay } as CSSProperties}
      role="img"
      aria-label="Golden light traces the seams of a black, white and gold football, which then fades in"
    >
      <div className="br-anim br-stage">
        <svg className="br-svg" viewBox="-400 -400 800 800" aria-hidden>
          <defs>
            <radialGradient id={`brHalo${uid}`} cx=".5" cy=".5" r=".5">
              <stop offset=".55" stopColor="#e9a868" stopOpacity=".22" />
              <stop offset="1" stopColor="#e9a868" stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`brShadow${uid}`} cx=".5" cy=".5" r=".5">
              <stop offset="0" stopColor="#000000" stopOpacity=".85" />
              <stop offset="1" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse className="br-anim br-shadow" cx="0" cy="292" rx="210" ry="22" fill={`url(#brShadow${uid})`} />
          <circle className="br-anim br-halo" cx="0" cy="0" r="330" fill={`url(#brHalo${uid})`} />
        </svg>

        <div className="br-box br-anim br-ball">
          {/* eslint-disable-next-line @next/next/no-img-element -- layered artwork, sized by its box */}
          <img src={ballImage.src} alt="" decoding="async" fetchPriority="low" />
        </div>
        <div className="br-box br-anim br-lights">
          {/* eslint-disable-next-line @next/next/no-img-element -- layered artwork, sized by its box */}
          <img className="br-bloom" src={lightsImage.src} alt="" decoding="async" fetchPriority="low" />
          {/* eslint-disable-next-line @next/next/no-img-element -- layered artwork, sized by its box */}
          <img className="br-glow" src={lightsImage.src} alt="" decoding="async" fetchPriority="low" />
          {/* eslint-disable-next-line @next/next/no-img-element -- layered artwork, sized by its box */}
          <img src={lightsImage.src} alt="" decoding="async" fetchPriority="low" />
        </div>

        <svg className="br-svg" viewBox="-400 -400 800 800" aria-hidden style={{ mixBlendMode: "screen" }}>
          <defs>
            <filter id={`brBlur${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          <g className="br-anim br-rimg">
            <g filter={`url(#brBlur${uid})`} stroke="#f0ae6a" strokeWidth="9">
              {[0, 120, 240].map((angle) => (
                <path key={angle} className="br-anim br-rim" pathLength={1} d={ARC} transform={`rotate(${angle})`} />
              ))}
            </g>
            <g stroke="#fff3e2" strokeWidth="1.6">
              {[0, 120, 240].map((angle) => (
                <path key={angle} className="br-anim br-rim" pathLength={1} d={ARC} transform={`rotate(${angle})`} />
              ))}
            </g>
          </g>
        </svg>

        <div className="br-sheenclip">
          <div className="br-anim br-sheen" />
        </div>
      </div>
    </div>
  );
}
