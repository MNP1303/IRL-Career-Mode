"use client";

import type { GpsBackend } from "@/lib/gps/backend";
import { localBackend } from "@/lib/gps/backends/local";
import { supabaseBackend } from "@/lib/gps/backends/supabase";
import { useAccount } from "@/lib/store";

/**
 * Where this player's GPS data lives: their account when signed in, this
 * browser otherwise. Null while the account is still loading.
 */
export function useGpsBackend(): GpsBackend | null {
  const account = useAccount();
  if (account.status === "loading") return null;
  return account.status === "signed-in" ? supabaseBackend : localBackend;
}

export function storageDescription(backend: GpsBackend) {
  return backend.kind === "account"
    ? "Saved privately to your account. The original file is kept in private storage so you can re-trim or recalibrate later."
    : "Saved in this browser only, like the rest of a guest career. Sign in to keep it across devices.";
}
