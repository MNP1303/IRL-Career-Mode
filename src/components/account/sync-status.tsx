"use client";

import type { AccountSnapshot } from "@/lib/store";
import { cn } from "@/lib/utils";

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

export function syncLabel(account: AccountSnapshot) {
  if (account.sync === "error") return "Not synced";
  if (account.sync === "syncing") return "Syncing…";
  if (account.pending > 0) return `${account.pending} ${account.pending === 1 ? "change" : "changes"} waiting`;
  if (account.sync === "synced") return "Synced";
  return "Connecting…";
}

export function lastSyncedLabel(iso: string | null) {
  if (!iso) return "Not synced yet";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 45) return "Last synced just now";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `Last synced ${relative.format(minutes, "minute")}`;
  return `Last synced ${relative.format(Math.round(minutes / 60), "hour")}`;
}

export function SyncDot({ account, className }: { account: AccountSnapshot; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 rounded-full ring-2 ring-background",
        account.sync === "error"
          ? "bg-loss"
          : account.sync === "syncing" || account.pending > 0
            ? "animate-pulse bg-amber-300"
            : "bg-primary",
        className,
      )}
    />
  );
}
