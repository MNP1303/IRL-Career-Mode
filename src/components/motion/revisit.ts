"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

const visited = new Set<string>();

/**
 * Whether this page was already shown earlier in the session, so its
 * entrances shouldn't replay: coming back to a view shows it as it was left.
 * Read `.current` in a layout effect declared after this hook, or later.
 * (Checked in layout effects and recorded in passive ones, so every entrance
 * on a page agrees, including when a kept-alive page is shown again.)
 */
export function useRevisit() {
  const pathname = usePathname();
  const revisit = useRef(false);
  useLayoutEffect(() => {
    revisit.current = visited.has(pathname);
  }, [pathname]);
  useEffect(() => {
    visited.add(pathname);
  }, [pathname]);
  return revisit;
}
