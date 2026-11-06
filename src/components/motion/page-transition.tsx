"use client";

import { ViewTransition, type ReactNode } from "react";

/**
 * Wraps each page so route changes animate with the View Transitions API.
 * Moving along the main navigation slides in that direction ("nav-forward" /
 * "nav-back", set on the nav links); any other navigation rises gently into
 * place. Old content leaves quickly while the new arrives, so navigation is
 * never held up. Browsers without view transitions simply switch pages.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const motion = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "nav-rise" };
  return (
    <ViewTransition enter={motion} exit={motion} default="none">
      {children}
    </ViewTransition>
  );
}
