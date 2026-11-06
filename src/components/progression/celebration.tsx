"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BadgeMedal, rarityLabel } from "@/components/career/badge-medal";
import { CountUp, ResultBadge } from "@/components/shared/primitives";
import { ATTRIBUTES } from "@/lib/domain";
import type { MatchProgress } from "@/lib/engine/career";
import { levelFromXp, levelTitle } from "@/lib/engine/progression";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { scoreline } from "@/lib/stats";
import { useCareer } from "@/lib/store";

const CelebrationContext = createContext<(matchId: string) => void>(() => {});

export function useCelebrate() {
  return useContext(CelebrationContext);
}

type Step = "report" | "level" | "badges";

function ReportStep({ entry }: { entry: MatchProgress }) {
  const { match } = entry;
  const before = levelFromXp(entry.xpBefore);
  const after = levelFromXp(entry.xpAfter);
  const score = scoreline(match);
  const crossedLevel = entry.levelAfter > entry.levelBefore;
  const scope = useRef<HTMLDivElement>(null);
  const endWidth = `${after.progress * 100}%`;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap
        .timeline()
        .from('[data-a="kicker"]', { opacity: 0, y: -8, duration: 0.4 })
        .from('[data-a="score"]', { opacity: 0, scale: 1.25, duration: 0.55, ease: "back.out(1.6)" }, 0.1)
        .from('[data-a="xp-line"]', { opacity: 0, x: -10, duration: 0.35, stagger: 0.08 }, 0.3)
        .fromTo(
          '[data-a="xp-fill"]',
          { width: crossedLevel ? "0%" : `${before.progress * 100}%` },
          { width: endWidth, duration: 1.1, ease: EASE.settle },
          0.7,
        )
        .from('[data-a="change"]', { opacity: 0, y: 6, duration: 0.35, stagger: 0.08 }, 0.9);
    },
    { scope },
  );

  return (
    <div ref={scope} className="mx-auto w-full max-w-lg">
      <p data-a="kicker" className="eyebrow text-center text-primary">
        Full time
      </p>
      <div data-a="score" className="mt-3 flex items-center justify-center gap-4">
        <ResultBadge result={match.result} size="lg" />
        <p className="numeral text-numeral">{score ?? "Logged"}</p>
      </div>
      {match.opponent ? (
        <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">vs {match.opponent}</p>
      ) : null}

      <div className="panel mt-6 p-card">
        <div className="flex items-baseline justify-between">
          <h3 className="eyebrow">XP earned</h3>
          <p className="stat text-stat-lg text-primary">
            +<CountUp value={entry.xpGained} duration={1.2} />
          </p>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {entry.xpLines.map((line) => (
            <li key={line.label} data-a="xp-line" className="flex justify-between gap-4 text-muted-foreground">
              <span>{line.label}</span>
              <span className="font-medium text-foreground tabular-nums">+{line.amount}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
            <span>Level {entry.levelAfter}</span>
            <span className="tabular-nums">
              {after.into} / {after.needed} XP
            </span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div data-a="xp-fill" className="h-full rounded-full bg-primary" style={{ width: endWidth }} />
          </div>
        </div>
      </div>

      <div className="panel mt-3 p-card">
        <div className="flex items-baseline justify-between">
          <h3 className="eyebrow">Player development</h3>
          <p className="stat text-stat-sm">
            OVR {entry.ovrBefore}
            {entry.ovrAfter !== entry.ovrBefore ? ` → ${entry.ovrAfter}` : ""}
          </p>
        </div>
        {entry.changes.length ? (
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {entry.changes.map((change) => (
              <li key={change.key} data-a="change" className="flex items-baseline justify-between gap-2">
                <span className="font-display text-xs font-semibold tracking-wide text-muted-foreground">
                  {ATTRIBUTES[change.key].code}
                </span>
                <span
                  className={
                    change.delta >= 0
                      ? "stat text-base font-bold text-positive"
                      : "stat text-base font-bold text-loss"
                  }
                >
                  {change.delta >= 0 ? "+" : "−"}
                  {Math.abs(change.delta).toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No attributes rated, so none of them moved.
          </p>
        )}
      </div>
    </div>
  );
}

const RAYS = Array.from({ length: 28 }, (_, index) => index);
const SPARKS = Array.from({ length: 26 }, (_, index) => ({
  angle: (index / 26) * Math.PI * 2 + (index % 3) * 0.13,
  distance: 170 + ((index * 37) % 180),
  size: 3 + (index % 4) * 2,
  delay: (index % 5) * 0.03,
}));

function LevelStep({ entry }: { entry: MatchProgress }) {
  const newTitle = levelTitle(entry.levelAfter);
  const promoted = newTitle !== levelTitle(entry.levelBefore);
  const scope = useRef<HTMLDivElement>(null);
  const [animated] = useState(() => !prefersReducedMotion());

  useGSAP(
    () => {
      if (!animated) return;
      const timeline = gsap.timeline();
      timeline
        .from('[data-a="rays"]', { opacity: 0, scale: 0.4, rotate: -14, duration: 2.2, ease: EASE.settle }, 0)
        .fromTo(
          '[data-a="kicker"]',
          { opacity: 0, letterSpacing: "0.6em" },
          { opacity: 1, letterSpacing: "0.22em", duration: 0.7 },
          0,
        )
        .from('[data-a="level"]', { opacity: 0, scale: 2.4, duration: 0.7, ease: "back.out(1.4)" }, 0.15)
        .from('[data-a="title"]', { opacity: 0, y: 12, duration: 0.45 }, 0.6);
      // Sparks burst outward from the number, then fade.
      gsap.utils.toArray<HTMLElement>('[data-a="spark"]').forEach((node, index) => {
        const spark = SPARKS[index];
        timeline.fromTo(
          node,
          { x: 0, y: 0, opacity: 1, scale: 0, rotate: (spark.angle * 180) / Math.PI + 90 },
          {
            x: Math.cos(spark.angle) * spark.distance,
            y: Math.sin(spark.angle) * spark.distance,
            opacity: 0,
            scale: 1,
            duration: 1.3,
            ease: "power4.out",
          },
          0.25 + spark.delay,
        );
      });
    },
    { scope },
  );

  return (
    <div ref={scope} className="relative flex min-h-[420px] flex-col items-center justify-center text-center">
      <svg
        data-a="rays"
        viewBox="-200 -200 400 400"
        className="pointer-events-none absolute top-1/2 left-1/2 size-[640px] max-w-none -translate-x-1/2 -translate-y-1/2"
        aria-hidden
      >
        <defs>
          <radialGradient id="ray-fade">
            <stop offset="0.2" stopColor="#c8ff00" stopOpacity="0.4" />
            <stop offset="1" stopColor="#c8ff00" stopOpacity="0" />
          </radialGradient>
        </defs>
        {RAYS.map((ray) => (
          <path
            key={ray}
            d="M-5 0L0-200L5 0Z"
            fill="url(#ray-fade)"
            transform={`rotate(${(ray / RAYS.length) * 360})`}
          />
        ))}
      </svg>

      {animated
        ? SPARKS.map((spark, index) => (
            <span
              key={index}
              data-a="spark"
              aria-hidden
              className="absolute top-1/2 left-1/2 bg-primary opacity-0"
              style={{ width: spark.size, height: spark.size * 3 }}
            />
          ))
        : null}

      <p data-a="kicker" className="eyebrow relative text-lg tracking-[0.22em] text-primary">
        Level up
      </p>
      <p data-a="level" className="numeral relative mt-2 text-[8.5rem] text-primary sm:text-[11rem]">
        {entry.levelAfter}
      </p>
      <p data-a="title" className="display relative mt-4 text-page">
        {promoted ? `Promoted to ${newTitle}` : newTitle}
      </p>
    </div>
  );
}

function BadgesStep({ entry }: { entry: MatchProgress }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap
        .timeline()
        .from("li", {
          opacity: 0,
          rotateX: -70,
          y: 18,
          transformPerspective: 700,
          transformOrigin: "50% 0%",
          duration: 0.6,
          ease: "back.out(1.4)",
          stagger: 0.14,
        })
        .from("[data-medal]", { scale: 0.5, rotate: -16, duration: 0.55, ease: EASE.pop, stagger: 0.14 }, 0.15);
    },
    { scope },
  );

  return (
    <div ref={scope} className="mx-auto w-full max-w-md text-center">
      <p className="eyebrow text-primary">
        {entry.unlocked.length === 1 ? "Badge unlocked" : `${entry.unlocked.length} badges unlocked`}
      </p>
      <ul className="mt-6 space-y-3 text-left">
        {entry.unlocked.map((badge) => (
          <li key={badge.id} className="panel flex items-center gap-4 p-4">
            <span data-medal className="shrink-0">
              <BadgeMedal icon={badge.icon} rarity={badge.rarity} />
            </span>
            <div className="min-w-0">
              <p className="heading text-title">{badge.name}</p>
              <p className="text-sm text-muted-foreground">{badge.description}</p>
              <p className="eyebrow mt-1">{rarityLabel(badge.rarity)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Celebration({ entry, onClose }: { entry: MatchProgress; onClose: () => void }) {
  const steps = useMemo<Step[]>(
    () => [
      "report",
      ...(entry.levelAfter > entry.levelBefore ? (["level"] as const) : []),
      ...(entry.unlocked.length ? (["badges"] as const) : []),
    ],
    [entry],
  );
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;
  const stage = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(stage.current, { opacity: 0, x: 28 }, { opacity: 1, x: 0, duration: 0.25, ease: EASE.out });
    },
    { dependencies: [step] },
  );

  function advance() {
    if (last) return onClose();
    if (leaving.current) return;
    if (prefersReducedMotion()) return setIndex(index + 1);
    leaving.current = true;
    gsap.to(stage.current, {
      opacity: 0,
      x: -28,
      duration: 0.18,
      ease: EASE.inOut,
      onComplete: () => {
        leaving.current = false;
        setIndex(index + 1);
      },
    });
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="brand-pattern brand-overlay fixed inset-0 z-50 overflow-x-hidden overflow-y-auto outline-none">
          <DialogPrimitive.Title className="sr-only">Match processed</DialogPrimitive.Title>
          <div className="flex min-h-full flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="flex flex-1 items-center justify-center py-4">
              <div ref={stage} key={step} className="w-full">
                {step === "report" ? <ReportStep entry={entry} /> : null}
                {step === "level" ? <LevelStep entry={entry} /> : null}
                {step === "badges" ? <BadgesStep entry={entry} /> : null}
              </div>
            </div>

            <div className="relative mx-auto flex w-full max-w-lg items-center justify-between gap-3">
              <div className="flex gap-1.5" aria-hidden>
                {steps.map((name, stepIndex) => (
                  <span
                    key={name}
                    className={
                      stepIndex <= index ? "h-1 w-6 -skew-x-[24deg] bg-primary" : "h-1 w-6 -skew-x-[24deg] bg-accent"
                    }
                  />
                ))}
              </div>
              <Button variant="cta" size="lg" data-icon="inline-end" onClick={advance}>
                {last ? "Back to career" : "Continue"}
                <ArrowRight strokeWidth={3} />
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [matchId, setMatchId] = useState<string | null>(null);
  const { career } = useCareer();
  const entry = matchId ? career.byMatchId.get(matchId) : undefined;

  return (
    <CelebrationContext.Provider value={setMatchId}>
      {children}
      {entry ? <Celebration key={entry.match.id} entry={entry} onClose={() => setMatchId(null)} /> : null}
    </CelebrationContext.Provider>
  );
}
