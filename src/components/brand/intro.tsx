"use client";

import { useEffect, useState } from "react";
import { BallReveal } from "@/components/brand/ball-reveal";
import { prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/utils";

/** Setting this to "off" in localStorage turns the loading animations off. */
const LOADER_KEY = "irl-career-mode:loader";

/** Page load: the formation runs on a 4s loop, so the ball is whole at 48%. */
const PAGE_DURATION = 4;
const PAGE_FORMED_MS = PAGE_DURATION * 1000 * 0.48 + 150;
const PAGE_FADE_MS = 350;

function loaderEnabled() {
  if (prefersReducedMotion()) return false;
  try {
    return localStorage.getItem(LOADER_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Milliseconds since the server-rendered loader first painted, so it can finish rather than restart. */
function sinceFirstPaint() {
  const paint = performance.getEntriesByType("paint").find((entry) => entry.name === "first-paint");
  return performance.now() - (paint?.startTime ?? 0);
}

/**
 * The page-load animation. It's in the server-rendered HTML, so it plays from
 * the first paint while the app loads, and the same element stays mounted
 * through hydration, so the formation never restarts. Once the app is ready it
 * finishes forming the ball and fades away; a key, click or tap skips it.
 */
export function PageLoader({ ready }: { ready: boolean }) {
  const [phase, setPhase] = useState<"playing" | "leaving" | "done">("playing");

  useEffect(() => {
    if (!ready || phase !== "playing") return;
    const animated = loaderEnabled();
    const wait = animated ? Math.max(0, PAGE_FORMED_MS - sinceFirstPaint()) : 0;
    const timer = window.setTimeout(() => setPhase(animated ? "leaving" : "done"), wait);
    const skip = () => setPhase("leaving");
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", skip);
    };
  }, [ready, phase]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase("done"), PAGE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div
      data-page-loader
      aria-busy={!ready}
      aria-label={ready ? undefined : "Loading your career"}
      onPointerDown={() => ready && setPhase("leaving")}
      className={cn(
        "fixed inset-0 z-[70] grid place-items-center bg-[#0a0908] transition-opacity ease-out",
        phase === "leaving" && "pointer-events-none opacity-0",
      )}
      style={{ transitionDuration: `${PAGE_FADE_MS}ms` }}
    >
      <div className="flex flex-col items-center gap-5">
        <BallReveal duration={PAGE_DURATION} />
        <p className="eyebrow tracking-[0.32em] text-foreground/75">IRL Career Mode</p>
      </div>
      {ready ? (
        <button
          type="button"
          onClick={() => setPhase("leaving")}
          className="absolute right-gutter bottom-[max(1.5rem,env(safe-area-inset-bottom))] rounded-md px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Skip
        </button>
      ) : null}
    </div>
  );
}
