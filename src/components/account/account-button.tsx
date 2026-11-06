"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { SyncDot, syncLabel } from "@/components/account/sync-status";
import { useAccount } from "@/lib/store";

export function AccountButton() {
  const account = useAccount();
  if (account.status === "loading") return null;

  if (account.status === "signed-in" && account.user) {
    const initial = (account.user.email[0] ?? "?").toUpperCase();
    return (
      <Link
        href="/account"
        aria-label={`Account, ${syncLabel(account).toLowerCase()}`}
        title={account.user.email}
        className="relative grid size-9 place-items-center rounded-full bg-accent font-display text-sm font-bold outline-none transition-colors hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initial}
        <SyncDot account={account} className="absolute -right-0.5 -bottom-0.5" />
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      aria-label="Sign in"
      className="flex h-9 items-center gap-1.5 rounded-md px-2 font-display text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5"
    >
      <LogIn className="size-4" />
      <span className="hidden whitespace-nowrap sm:inline md:hidden lg:inline">Sign in</span>
    </Link>
  );
}
