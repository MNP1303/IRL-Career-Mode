"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import { CalendarDays, Flame, LayoutGrid, Plus, TrendingUp, UserRound } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LinkButton } from "@/components/shared/primitives";
import { CursorRipple } from "@/components/brand/cursor-ripple";
import { PageLoader } from "@/components/brand/intro";
import { ParallaxPattern } from "@/components/motion/parallax-pattern";
import { CelebrationProvider } from "@/components/progression/celebration";
import { AccountButton } from "@/components/account/account-button";
import { GuestImportDialog } from "@/components/account/guest-import-dialog";
import { EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { actions, useAppState, useCareer } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Hub", icon: LayoutGrid },
  { href: "/matches", label: "Matches", icon: CalendarDays },
  { href: "/pitch", label: "Pitch", icon: Flame },
  { href: "/career", label: "Career", icon: TrendingUp },
  { href: "/player", label: "Player", icon: UserRound },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Pages slide in the direction you travel along the nav: right is forward, left is back. */
function directionTo(pathname: string, href: string) {
  const from = NAV.findIndex((item) => isActive(pathname, item.href));
  const to = NAV.findIndex((item) => item.href === href);
  const current = from === -1 ? NAV.length : from;
  if (to === current) return undefined;
  return [to > current ? "nav-forward" : "nav-back"];
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <svg viewBox="0 0 32 36" className="h-7 w-auto" aria-hidden>
        <path d="M6 0h20l6 6v18.500c0 1.300-.7 2.400-1.900 3L17.600 35a3.500 3.500 0 0 1-3.200 0L1.900 27.500C.7 26.900 0 25.800 0 24.500V6z" fill="var(--primary)" />
        <path d="M19 6.500l-8.500 12.800h5.700L13.400 29l8.800-13.400h-5.800z" fill="var(--primary-foreground)" />
      </svg>
      <span className="font-display text-[0.8125rem] leading-[1.05] font-extrabold tracking-[-0.01em] whitespace-nowrap uppercase">
        IRL Career
        <span className="block text-primary">Mode</span>
      </span>
    </Link>
  );
}

function TopBar() {
  const pathname = usePathname();
  const { career, profile } = useCareer();

  return (
    <header
      className="sticky top-0 z-40 border-b border-border bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="mx-auto flex h-16 max-w-app items-center gap-4 px-gutter lg:gap-6">
        <Logo />

        <nav aria-label="Main" className="mx-auto hidden items-stretch gap-1 self-stretch md:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                transitionTypes={directionTo(pathname, item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center px-3 font-display text-sm font-medium transition-colors duration-(--dur-hover) outline-none focus-visible:text-foreground lg:px-3.5",
                  // A quiet surface appears behind the label on hover, as in a desktop app.
                  "before:absolute before:inset-x-1 before:inset-y-3.5 before:rounded-md before:bg-foreground/0 before:transition-colors before:duration-(--dur-hover) hover:before:bg-foreground/[0.05] focus-visible:before:bg-foreground/[0.07]",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">{item.label}</span>
                {active ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-3 -bottom-px h-0.5 bg-primary lg:inset-x-4"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 md:ml-0">
          <AccountButton />
          <Link
            href="/player"
            aria-label={`${profile.name}, level ${career.level.level}, ${career.ovr} overall`}
            className="flex items-center gap-2.5 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="hidden text-right leading-none sm:block md:hidden lg:block">
              <span className="block font-display text-xs font-bold">
                Level {career.level.level}
              </span>
              <span className="mt-1 block text-label text-muted-foreground tabular-nums">
                {career.level.into} / {career.level.needed} XP
              </span>
            </span>
            <LevelRing progress={career.level.progress} ovr={career.ovr} />
          </Link>
          <LinkButton href="/matches/new" variant="cta" className="hidden md:inline-flex" data-icon="inline-start">
            <Plus strokeWidth={3} />
            Log match
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

function LevelRing({ progress, ovr }: { progress: number; ovr: number }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const arc = useRef<SVGCircleElement>(null);

  useGSAP(
    () => {
      const offset = circumference * (1 - progress);
      if (prefersReducedMotion()) gsap.set(arc.current, { strokeDashoffset: offset });
      else gsap.to(arc.current, { strokeDashoffset: offset, duration: 1.1, ease: EASE.settle, delay: 0.2 });
    },
    { dependencies: [progress] },
  );

  return (
    <span className="relative grid size-10 place-items-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="20" cy="20" r={radius} fill="none" stroke="var(--primary)" strokeOpacity="0.15" strokeWidth="3" />
        <circle
          ref={arc}
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
      <span className="stat text-sm font-bold">{ovr}</span>
    </span>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const items = NAV.filter((item) => item.href !== "/player");
  const left = items.slice(0, 2);
  const right = items.slice(2);

  const renderItem = (item: (typeof items)[number]) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        transitionTypes={directionTo(pathname, item.href)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center gap-1 font-display text-label font-semibold transition-[color,transform] duration-(--dur-press) active:scale-95",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {active ? (
          <motion.span
            layoutId="bottom-active"
            className="absolute inset-x-5 top-0 h-0.5 bg-primary"
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
          />
        ) : null}
        <Icon className="size-5" />
        {item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      style={{ viewTransitionName: "site-nav" }}
    >
      <div className="flex h-16 items-stretch">
        {left.map(renderItem)}
        <div className="flex w-16 shrink-0 items-center justify-center">
          <Link
            href="/matches/new"
            aria-label="Log match"
            className="chamfer grid size-12 -translate-y-3 place-items-center bg-primary text-primary-foreground active:scale-95"
          >
            <Plus className="size-6" strokeWidth={3} />
          </Link>
        </div>
        {right.map(renderItem)}
      </div>
    </nav>
  );
}

function DemoBanner() {
  const { isDemo, matches } = useCareer();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  if (!isDemo) return null;
  const sampleCount = matches.filter((match) => match.isSample).length;

  return (
    <>
      <div className="border-b border-border bg-surface" style={{ viewTransitionName: "demo-banner" }}>
        <div className="mx-auto flex max-w-app items-center justify-between gap-3 px-gutter py-1.5">
          <p className="min-w-0 text-xs text-muted-foreground">
            <span className="eyebrow mr-2 text-primary">Demo career</span>
            <span className="hidden sm:inline">Kai Mercer is fictional and these {sampleCount} matches are sample data.</span>
            <span className="sm:hidden">Sample data only.</span>
          </p>
          <Button size="xs" variant="secondary" className="shrink-0" onClick={() => setConfirming(true)}>
            Start my career
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start your real career?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the demo player and {sampleCount} sample matches. Anything you logged yourself is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep exploring</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                actions.startRealCareer();
                setConfirming(false);
                router.push("/player");
              }}
            >
              Start my career
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LoadedApp({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inForm = pathname === "/matches/new" || pathname.endsWith("/edit");
  return (
    <CelebrationProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <TopBar />
      <DemoBanner />
      <main
        id="main"
        className={cn(
          "mx-auto w-full max-w-app px-gutter pt-6 sm:pt-8",
          inForm ? "pb-32 lg:pb-16" : "pb-28 md:pb-16",
        )}
      >
        {children}
      </main>
      {inForm ? null : <BottomNav />}
      <GuestImportDialog />
      <CursorRipple />
    </CelebrationProvider>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const state = useAppState();
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <ParallaxPattern />
        {state ? <LoadedApp>{children}</LoadedApp> : null}
        {/* Mounted from the server render onwards, so the page-load animation never restarts. */}
        <PageLoader ready={state !== null} />
        <Toaster position="top-center" />
      </TooltipProvider>
    </MotionConfig>
  );
}
