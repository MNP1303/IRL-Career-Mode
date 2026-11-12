"use client";

import Link from "next/link";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useRevisit } from "@/components/motion/revisit";
import { RESULT_META, type MatchResult } from "@/lib/domain";

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-section flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="eyebrow mb-2 flex items-center gap-2">
          <span className="h-0.5 w-4 bg-primary" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="display text-page">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({
  title,
  aside,
  className,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-baseline justify-between gap-4", className)}>
      <h2 className="heading text-title">{title}</h2>
      {aside ? <div className="shrink-0 text-xs text-muted-foreground tabular-nums">{aside}</div> : null}
    </div>
  );
}

export function ResultBadge({ result, size = "md" }: { result: MatchResult; size?: "sm" | "md" | "lg" }) {
  const meta = RESULT_META[result];
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm font-display font-bold",
        size === "sm" && "size-6 text-xs",
        size === "md" && "size-7 text-xs",
        size === "lg" && "size-10 text-base",
        result === "win" && "bg-primary/12 text-primary ring-1 ring-primary/35 ring-inset",
        result === "draw" && "bg-accent text-foreground/85",
        result === "loss" && "bg-loss/14 text-loss ring-1 ring-loss/35 ring-inset",
      )}
    >
      <span className="sr-only">{meta.label}</span>
      <span aria-hidden>{meta.letter}</span>
    </span>
  );
}

export function RatingChip({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn(
        "stat inline-flex h-7 min-w-11 items-center justify-center rounded-sm px-1.5 text-sm font-bold",
        rating >= 8
          ? "bg-primary text-primary-foreground"
          : rating >= 6.5
            ? "bg-foreground text-background"
            : rating >= 5
              ? "bg-accent text-foreground"
              : "bg-loss/14 text-loss",
        className,
      )}
    >
      {rating.toFixed(1)}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-input px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-accent text-foreground [&_svg]:size-5">
        {icon}
      </div>
      <h3 className="heading text-title">{title}</h3>
      {children ? <p className="mt-2 max-w-sm text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Becomes true the first time the element scrolls into view. */
function useSeenOnce<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

const formatNumber = (value: number, decimals: number) =>
  value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Counts a number up when it scrolls into view, writing to the DOM rather than re-rendering. */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
  duration = 0.9,
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const [ref, seen] = useSeenOnce<HTMLSpanElement>();
  const shown = useRef({ value: 0 });
  const revisit = useRevisit();
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !seen) return;
    const render = () => {
      node.textContent = `${formatNumber(shown.current.value, decimals)}${suffix}`;
    };
    // Coming back to a page, figures are already there; only real changes count.
    if (!started.current) {
      started.current = true;
      if (revisit.current) shown.current.value = value;
    }
    if (prefersReducedMotion()) {
      shown.current.value = value;
      render();
      return;
    }
    // Later changes count on from the current figure rather than from zero.
    const tween = gsap.to(shown.current, { value, duration, ease: EASE.settle, onUpdate: render });
    return () => {
      tween.kill();
    };
  }, [ref, seen, value, decimals, suffix, duration, revisit]);

  return (
    <span ref={ref} className={className}>
      {`${formatNumber(value, decimals)}${suffix}`}
    </span>
  );
}

export function XpBar({ progress, className, label }: { progress: number; className?: string; label: string }) {
  const fill = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const revisit = useRevisit();

  useGSAP(
    () => {
      const width = `${Math.max(progress * 100, 1.5)}%`;
      if (prefersReducedMotion() || (first.current && revisit.current)) {
        first.current = false;
        gsap.set(fill.current, { width });
        return;
      }
      // The first fill waits for the entrance; later XP gains slide on from where they were.
      gsap.to(fill.current, { width, duration: 1.1, ease: EASE.settle, delay: first.current ? 0.3 : 0 });
      first.current = false;
    },
    { dependencies: [progress] },
  );

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("relative h-1 overflow-hidden rounded-full bg-foreground/10", className)}
    >
      <div ref={fill} className="xp-shimmer absolute inset-y-0 left-0 w-0 overflow-hidden rounded-full bg-primary" />
    </div>
  );
}

/**
 * The fill inside a progress track. It grows from empty on mount and
 * slides between values afterwards. `value` runs from 0 to 1.
 */
export function FillBar({ value, delay = 0, className }: { value: number; delay?: number; className?: string }) {
  const fill = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const revisit = useRevisit();

  useGSAP(
    () => {
      const width = `${Math.min(1, Math.max(0, value)) * 100}%`;
      if (prefersReducedMotion() || (first.current && revisit.current)) gsap.set(fill.current, { width });
      else gsap.to(fill.current, { width, duration: 0.9, ease: EASE.settle, delay: first.current ? delay : 0 });
      first.current = false;
    },
    { dependencies: [value] },
  );

  return <div ref={fill} className={cn("h-full w-0 rounded-full bg-primary", className)} />;
}

/** Sliding single-choice control used for formats, results and filters. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; ariaLabel?: string }[];
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-lg border border-border bg-surface p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.ariaLabel}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex-1 rounded-md font-display font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "md" ? "h-[calc(var(--size-control)-0.375rem)] px-3.5 text-sm" : "h-7 px-2.5 text-xs",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segment-${id}`}
                className="absolute inset-0 rounded-md bg-primary"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Page-level section tabs: text labels with an underline, like a game menu. */
export function TabBar<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in keys) && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const current = options.findIndex((option) => option.value === value);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + keys[event.key] + options.length) % options.length;
    onChange(options[next].value);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex gap-6 border-b border-border", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative -mb-px h-11 shrink-0 font-display text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:text-foreground focus-visible:underline",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {active ? (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Fades content up into place on mount. Pass `stagger` (a selector) to
 * bring in matching children one after another instead of as a block.
 */
export function Reveal({
  children,
  delay = 0,
  stagger,
  className,
}: {
  children: ReactNode;
  delay?: number;
  stagger?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const revisit = useRevisit();

  useGSAP(
    () => {
      if (prefersReducedMotion() || !ref.current) return;
      const targets = stagger ? ref.current.querySelectorAll(stagger) : ref.current;
      // Returning to a page: it's simply there (the route transition already eased it in).
      if (revisit.current) return;
      // Opacity, not visibility, so content stays reachable for screen readers mid-animation.
      gsap.from(targets, {
        opacity: 0,
        y: 14,
        duration: 0.55,
        delay,
        ease: EASE.out,
        stagger: stagger ? 0.07 : 0,
        clearProps: "opacity,transform",
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
