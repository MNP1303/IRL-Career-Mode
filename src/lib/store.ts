"use client";

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { z } from "zod";
import { computeCareer, type Career } from "@/lib/engine/career";
import { buildSampleMatches, SAMPLE_PROFILE } from "@/lib/sample-data";
import {
  careerFileSchema,
  matchSchema,
  profileSchema,
  type CareerFile,
  type Match,
  type MatchFields,
  type PlayerProfile,
} from "@/lib/schema";
import { getSupabase, supabaseConfigError, supabaseConfigured } from "@/lib/supabase";
import {
  applyOutbox,
  diffStates,
  enqueue,
  guestHasRealData,
  mergeCareers,
  opKey,
  pendingOpSchema,
  realMatches,
  rowsToState,
  settle,
  type Outbox,
} from "@/lib/sync";

const STORAGE_KEY = "irl-career-mode:v1";
const BACKUP_KEY = "irl-career-mode:unreadable-backup";
/** Each account gets its own cache so switching accounts never mixes careers. */
const accountKey = (userId: string) => `${STORAGE_KEY}:account:${userId}`;
const importDecisionKey = (userId: string) => `${STORAGE_KEY}:account:${userId}:guest-import`;

export interface AppState {
  profile: PlayerProfile;
  matches: Match[];
}

const storedStateSchema = z.object({
  profile: profileSchema,
  matches: z.array(matchSchema),
});

const accountCacheSchema = storedStateSchema.extend({
  outbox: z.record(z.string(), pendingOpSchema),
  remoteProfileExists: z.boolean(),
});

export const BLANK_PROFILE: PlayerProfile = {
  name: "New Signing",
  positions: ["CM"],
  nationality: "ENG",
  shirtNumber: 10,
  photo: null,
};

export type SyncState = "idle" | "syncing" | "synced" | "pending" | "error";

export interface AccountSnapshot {
  /** False until Supabase keys are added, and the app runs as a guest. */
  configured: boolean;
  configError: string | null;
  status: "loading" | "guest" | "signed-in";
  user: { id: string; email: string } | null;
  sync: SyncState;
  pending: number;
  lastSyncedAt: string | null;
  syncError: string | null;
  /** Set when the player opened a password reset link. */
  recovering: boolean;
  /** Offered once per account when this browser holds a guest career. */
  guestImport: { matches: number } | null;
}

const SERVER_ACCOUNT: AccountSnapshot = {
  configured: supabaseConfigured,
  configError: null,
  status: "loading",
  user: null,
  sync: "idle",
  pending: 0,
  lastSyncedAt: null,
  syncError: null,
  recovering: false,
  guestImport: null,
};

let state: AppState | null = null;
let account: AccountSnapshot = SERVER_ACCOUNT;
let outbox: Outbox = {};
let remoteProfileExists = false;
let started = false;
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryAttempt = 0;
let lastPulledAt = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setAccount(patch: Partial<AccountSnapshot>) {
  account = { ...account, ...patch };
  emit();
}

const signedInUser = () => (account.status === "signed-in" ? account.user : null);

function demoState(): AppState {
  return { profile: SAMPLE_PROFILE, matches: buildSampleMatches() };
}

function readItem(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeItem(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

/** The guest career, or null when this browser has never saved one. */
function readGuest(): AppState | null {
  const raw = readItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return storedStateSchema.parse(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy so nothing is silently lost.
    writeItem(BACKUP_KEY, raw);
    queueMicrotask(() =>
      toast.error("Saved career couldn't be read", {
        description: "A backup was kept in this browser and the demo career was loaded.",
      }),
    );
    return null;
  }
}

function readAccountCache(userId: string) {
  const raw = readItem(accountKey(userId));
  if (!raw) return null;
  try {
    const parsed = accountCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // A damaged cache is harmless: the next pull rebuilds it from the server.
    return null;
  }
}

function writeCache() {
  if (!state) return;
  const user = signedInUser();
  const saved = user
    ? writeItem(accountKey(user.id), JSON.stringify({ ...state, outbox, remoteProfileExists }))
    : writeItem(STORAGE_KEY, JSON.stringify(state));
  if (!saved) {
    toast.error("Couldn't save to this browser", {
      description: "Storage may be full. Try a smaller profile picture, or export your career.",
    });
  }
}

function persist(next: AppState) {
  const previous = state;
  state = next;
  if (signedInUser() && previous) {
    const ops = diffStates(previous, next);
    if (ops.length) {
      outbox = enqueue(outbox, ops);
      account = { ...account, pending: Object.keys(outbox).length, sync: "pending" };
    }
  }
  writeCache();
  emit();
  void flush();
}

// Account lifecycle ------------------------------------------------------------

/**
 * True when the guest career saved in this browser was brought into that
 * account and holds nothing the account doesn't: it's a leftover duplicate.
 */
function guestCopiedInto(userId: string, accountState: AppState | null) {
  if (readItem(importDecisionKey(userId)) !== "imported" || !accountState) return false;
  const guest = readGuest();
  if (!guest) return false;
  const known = new Set(accountState.matches.map((match) => match.id));
  return realMatches(guest).every((match) => known.has(match.id));
}

function enterGuest(previousUserId?: string) {
  if (previousUserId) {
    // A career brought into the account belongs to the account now, so signing
    // out mustn't leave a copy of it showing here as if still signed in.
    if (guestCopiedInto(previousUserId, state)) removeItem(STORAGE_KEY);
    // Signing out removes that account's cached copy from this browser.
    removeItem(accountKey(previousUserId));
  }
  outbox = {};
  remoteProfileExists = false;
  clearTimeout(retryTimer);
  state = readGuest() ?? demoState();
  setAccount({ status: "guest", user: null, sync: "idle", pending: 0, syncError: null, guestImport: null });
}

function enterAccount(user: { id: string; email: string }) {
  const cached = readAccountCache(user.id);
  state = cached ? { profile: cached.profile, matches: cached.matches } : { profile: BLANK_PROFILE, matches: [] };
  outbox = cached?.outbox ?? {};
  remoteProfileExists = cached?.remoteProfileExists ?? false;
  lastPulledAt = 0;
  setAccount({
    status: "signed-in",
    user,
    sync: "syncing",
    pending: Object.keys(outbox).length,
    syncError: null,
    guestImport: null,
  });
  void pull().then(() => offerGuestImport(user.id));
}

async function handleAuth(event: AuthChangeEvent | "INITIAL", session: Session | null) {
  if (event === "PASSWORD_RECOVERY") setAccount({ recovering: true });
  const user = session?.user;
  if (!user) {
    if (account.status !== "guest" || !state) enterGuest(account.user?.id);
    return;
  }
  // Token refreshes and repeat events for the same player change nothing here.
  if (account.user?.id === user.id && state) return;
  enterAccount({ id: user.id, email: user.email ?? "" });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const client = getSupabase();
  if (!client) {
    account = { ...account, configured: supabaseConfigured, configError: supabaseConfigError() };
    state = readGuest() ?? demoState();
    account = { ...account, status: "guest" };
    return;
  }
  client.auth.onAuthStateChange((event, session) => {
    // Supabase advises against calling its own methods inside this callback.
    setTimeout(() => void handleAuth(event, session), 0);
  });
  void client.auth
    .getSession()
    .then(({ data }) => handleAuth("INITIAL", data.session))
    .catch(() => enterGuest());

  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    // Picks up matches logged on another device when the player comes back.
    if (document.visibilityState === "visible" && Date.now() - lastPulledAt > 60_000) void pull();
  });
}

// Syncing -----------------------------------------------------------------------

function describeError(error: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You're offline. Changes are saved here and will sync when you reconnect.";
  }
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return message ? `Sync failed: ${message}` : "Sync failed. Your changes are saved here and will retry.";
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delays = [5_000, 20_000, 60_000];
  retryTimer = setTimeout(() => void flush(), delays[Math.min(retryAttempt, delays.length - 1)]);
  retryAttempt += 1;
}

const PAGE = 1000;

async function fetchAllMatches(userId: string) {
  const client = getSupabase()!;
  const rows: { data: unknown }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("matches")
      .select("data")
      .eq("user_id", userId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function pull() {
  const client = getSupabase();
  const user = signedInUser();
  if (!client || !user) return;
  lastPulledAt = Date.now();
  setAccount({ sync: "syncing" });
  try {
    const [profileResult, matchRows] = await Promise.all([
      client.from("profiles").select("data").eq("user_id", user.id).limit(1),
      fetchAllMatches(user.id),
    ]);
    if (profileResult.error) throw profileResult.error;
    // The player may have signed out while the request was running.
    if (signedInUser()?.id !== user.id) return;

    const remote = rowsToState(profileResult.data, matchRows, BLANK_PROFILE);
    remoteProfileExists = remote.hasProfile;
    state = applyOutbox(remote.state, outbox);
    writeCache();
    setAccount({ sync: Object.keys(outbox).length ? "pending" : "synced", lastSyncedAt: new Date().toISOString(), syncError: null });
    if (remote.rejected) {
      toast.warning(`${remote.rejected} saved ${remote.rejected === 1 ? "record" : "records"} couldn't be read`, {
        description: "They were skipped. Everything else loaded normally.",
      });
    }
    await flush();
  } catch (error) {
    if (signedInUser()?.id === user.id) setAccount({ sync: "error", syncError: describeError(error) });
  }
}

async function sendBatch(userId: string, batch: Outbox) {
  const client = getSupabase()!;
  const ops = Object.values(batch);
  const upserts = ops.flatMap((op) => (op.kind === "upsert-match" ? [{ user_id: userId, id: op.match.id, data: op.match }] : []));
  const deletes = ops.flatMap((op) => (op.kind === "delete-match" ? [op.id] : []));
  const profile = ops.find((op) => op.kind === "upsert-profile");

  for (let index = 0; index < upserts.length; index += 200) {
    const { error } = await client.from("matches").upsert(upserts.slice(index, index + 200), { onConflict: "user_id,id" });
    if (error) throw error;
  }
  for (let index = 0; index < deletes.length; index += 200) {
    const { error } = await client
      .from("matches")
      .delete()
      .eq("user_id", userId)
      .in("id", deletes.slice(index, index + 200));
    if (error) throw error;
  }
  if (profile?.kind === "upsert-profile") {
    const { error } = await client
      .from("profiles")
      .upsert({ user_id: userId, data: profile.profile }, { onConflict: "user_id" });
    if (error) throw error;
    remoteProfileExists = true;
  }
}

async function flush() {
  const user = signedInUser();
  if (!user || flushing || Object.keys(outbox).length === 0) return;
  flushing = true;
  const batch = outbox;
  setAccount({ sync: "syncing" });
  try {
    await sendBatch(user.id, batch);
    if (signedInUser()?.id !== user.id) return;
    outbox = settle(outbox, batch);
    retryAttempt = 0;
    clearTimeout(retryTimer);
    writeCache();
    const pending = Object.keys(outbox).length;
    setAccount({ sync: pending ? "pending" : "synced", pending, lastSyncedAt: new Date().toISOString(), syncError: null });
  } catch (error) {
    if (signedInUser()?.id === user.id) {
      setAccount({ sync: "error", syncError: describeError(error), pending: Object.keys(outbox).length });
      scheduleRetry();
    }
  } finally {
    flushing = false;
  }
  if (signedInUser()?.id === user.id && Object.keys(outbox).some((key) => outbox[key] !== batch[key])) {
    void flush();
  }
}

function offerGuestImport(userId: string) {
  if (signedInUser()?.id !== userId || readItem(importDecisionKey(userId))) return;
  const guest = readGuest();
  if (!guest || !guestHasRealData(guest, BLANK_PROFILE)) return;
  setAccount({ guestImport: { matches: realMatches(guest).length } });
}

// React bindings ----------------------------------------------------------------

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    const user = signedInUser();
    if (user && event.key === accountKey(user.id)) {
      const cached = readAccountCache(user.id);
      if (!cached) return;
      state = { profile: cached.profile, matches: cached.matches };
      outbox = cached.outbox;
      emit();
    } else if (!user && account.status === "guest" && event.key === STORAGE_KEY) {
      state = readGuest() ?? demoState();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot() {
  start();
  return state;
}

const getServerSnapshot = () => null;

export function useAppState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useAccount() {
  return useSyncExternalStore(
    subscribe,
    () => {
      start();
      return account;
    },
    () => SERVER_ACCOUNT,
  );
}

const careers = new WeakMap<AppState, Career>();

function careerFor(current: AppState) {
  let career = careers.get(current);
  if (!career) {
    career = computeCareer(current.matches, current.profile.positions[0]);
    careers.set(current, career);
  }
  return career;
}

/** For components rendered inside the hydration gate in `AppShell`. */
export function useCareer(): AppState & { career: Career; isDemo: boolean } {
  const current = useAppState();
  if (!current) throw new Error("useCareer must be used inside the hydrated app shell");
  const { profile, matches } = current;
  const isDemo = Boolean(profile.isSample) || matches.some((match) => match.isSample);
  return { profile, matches, career: careerFor(current), isDemo };
}

function requireState() {
  const current = getSnapshot();
  if (!current) throw new Error("The career hasn't loaded yet");
  return current;
}

function newId() {
  return `m-${crypto.randomUUID()}`;
}

export const actions = {
  addMatch(fields: MatchFields) {
    const match: Match = { ...fields, id: newId(), createdAt: new Date().toISOString() };
    const current = requireState();
    persist({ ...current, matches: [...current.matches, match] });
    return match;
  },
  updateMatch(id: string, fields: MatchFields) {
    const current = requireState();
    persist({
      ...current,
      matches: current.matches.map((match) =>
        match.id === id
          ? { ...fields, id, createdAt: match.createdAt, isSample: match.isSample }
          : match,
      ),
    });
  },
  deleteMatch(id: string) {
    const current = requireState();
    persist({ ...current, matches: current.matches.filter((match) => match.id !== id) });
  },
  restoreMatch(match: Match) {
    const current = requireState();
    if (current.matches.some((existing) => existing.id === match.id)) return;
    persist({ ...current, matches: [...current.matches, match] });
  },
  updateProfile(profile: PlayerProfile) {
    persist({ ...requireState(), profile: { ...profile, isSample: undefined } });
  },
  /** Drops sample records and keeps anything the player has entered. */
  startRealCareer() {
    const current = requireState();
    persist({
      profile: current.profile.isSample ? BLANK_PROFILE : current.profile,
      matches: current.matches.filter((match) => !match.isSample),
    });
  },
  /** Guest only: sample data never goes into an account. */
  loadDemo() {
    if (signedInUser()) return;
    persist(demoState());
  },
  resetCareer() {
    persist({ profile: BLANK_PROFILE, matches: [] });
  },
  importCareer(file: CareerFile, mode: "merge" | "replace") {
    const current = requireState();
    if (mode === "replace") {
      persist({ profile: file.profile ?? current.profile, matches: file.matches });
      return { added: file.matches.length, skipped: 0 };
    }
    const known = new Set(current.matches.map((match) => match.id));
    const fresh = file.matches.filter((match) => !known.has(match.id));
    persist({ ...current, matches: [...current.matches, ...fresh] });
    return { added: fresh.length, skipped: file.matches.length - fresh.length };
  },
  /** Copies this browser's guest career into the signed-in account. */
  importGuestCareer() {
    const user = signedInUser();
    const guest = readGuest();
    if (!user || !guest) return { added: 0, usedGuestProfile: false };
    const accountHasProfile = remoteProfileExists || "profile" in outbox;
    const merged = mergeCareers(requireState(), guest, accountHasProfile);
    writeItem(importDecisionKey(user.id), "imported");
    setAccount({ guestImport: null });
    persist(merged.state);
    // The career has moved into the account (cached and queued to sync), so the
    // browser's guest copy goes: signing out later must not reveal it.
    removeItem(STORAGE_KEY);
    return { added: merged.added, usedGuestProfile: merged.usedGuestProfile };
  },
  dismissGuestImport() {
    const user = signedInUser();
    if (user) writeItem(importDecisionKey(user.id), "dismissed");
    setAccount({ guestImport: null });
  },
  /** True when this browser's guest career has matches the account doesn't. */
  hasGuestCareer() {
    const guest = readGuest();
    if (!guest || !state) return false;
    const known = new Set(state.matches.map((match) => match.id));
    return realMatches(guest).some((match) => !known.has(match.id));
  },
  retrySync() {
    retryAttempt = 0;
    void (Object.keys(outbox).length ? flush() : pull());
  },
  finishRecovery() {
    setAccount({ recovering: false });
  },
};

/** The signed-in player's id, or null in guest mode. */
export function currentUserId() {
  return signedInUser()?.id ?? null;
}

/**
 * Resolves once a match is saved to the signed-in account, so rows that
 * reference it (GPS tracking) can be written. Rejects with a readable
 * message if it can't be synced right now.
 */
export async function ensureMatchSynced(matchId: string) {
  const user = signedInUser();
  if (!user) throw new Error("Sign in to save GPS data to your account.");
  const key = opKey({ kind: "delete-match", id: matchId });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (signedInUser()?.id !== user.id) throw new Error("You signed out before the GPS data was saved.");
    if (!state?.matches.some((match) => match.id === matchId)) throw new Error("This match isn't in your career.");
    if (!outbox[key]) return;
    if (flushing) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    await flush();
    if (outbox[key] && account.sync === "error") {
      throw new Error(account.syncError ?? "The match couldn't be synced to your account yet.");
    }
  }
  throw new Error("The match is still syncing. Try again in a moment.");
}

export function exportFile(current: AppState): CareerFile {
  return {
    app: "irl-career-mode",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: current.profile,
    matches: current.matches,
  };
}

export type ParsedImport =
  | { ok: true; file: CareerFile }
  | { ok: false; problems: string[] };

/** Turns raw file text into a validated career, with readable reasons if not. */
export function parseImport(text: string): ParsedImport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["This file isn't valid JSON."] };
  }
  const parsed = careerFileSchema.safeParse(json);
  if (parsed.success) return { ok: true, file: parsed.data };

  const problems = parsed.error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.join(".");
    const where = path.replace(/^matches\.(\d+)/, (_, index) => `Match ${Number(index) + 1}`);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  if (parsed.error.issues.length > 6) {
    problems.push(`…and ${parsed.error.issues.length - 6} more`);
  }
  return { ok: false, problems };
}
