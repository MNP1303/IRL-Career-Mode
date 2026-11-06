import { z } from "zod";
import { matchSchema, profileSchema, type Match, type PlayerProfile } from "@/lib/schema";

/**
 * Pure sync rules, kept free of Supabase so they can be unit tested. The store
 * diffs every state change into pending operations, keeps them in an outbox
 * until the server confirms them, and lays them over fresh server data so an
 * unsynced edit is never overwritten by a pull.
 */

export interface CareerState {
  profile: PlayerProfile;
  matches: Match[];
}

export type PendingOp =
  | { kind: "upsert-match"; match: Match }
  | { kind: "delete-match"; id: string }
  | { kind: "upsert-profile"; profile: PlayerProfile };

/** One entry per record, so a later edit replaces an earlier unsent one. */
export type Outbox = Record<string, PendingOp>;

export const pendingOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upsert-match"), match: matchSchema }),
  z.object({ kind: z.literal("delete-match"), id: z.string().min(1) }),
  z.object({ kind: z.literal("upsert-profile"), profile: profileSchema }),
]);

export function opKey(op: PendingOp) {
  if (op.kind === "upsert-profile") return "profile";
  return `match:${op.kind === "upsert-match" ? op.match.id : op.id}`;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function diffStates(before: CareerState, after: CareerState): PendingOp[] {
  const ops: PendingOp[] = [];
  const previous = new Map(before.matches.map((match) => [match.id, match]));
  const next = new Set<string>();

  for (const match of after.matches) {
    next.add(match.id);
    const old = previous.get(match.id);
    if (!old || !same(old, match)) ops.push({ kind: "upsert-match", match });
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) ops.push({ kind: "delete-match", id });
  }
  if (!same(before.profile, after.profile)) ops.push({ kind: "upsert-profile", profile: after.profile });
  return ops;
}

export function enqueue(outbox: Outbox, ops: PendingOp[]): Outbox {
  const next = { ...outbox };
  for (const op of ops) next[opKey(op)] = op;
  return next;
}

/** Removes only the entries that weren't replaced while the request was in flight. */
export function settle(outbox: Outbox, sent: Outbox): Outbox {
  const next = { ...outbox };
  for (const [key, op] of Object.entries(sent)) {
    if (next[key] === op) delete next[key];
  }
  return next;
}

export function applyOutbox(state: CareerState, outbox: Outbox): CareerState {
  const matches = new Map(state.matches.map((match) => [match.id, match]));
  let profile = state.profile;
  for (const op of Object.values(outbox)) {
    if (op.kind === "upsert-match") matches.set(op.match.id, op.match);
    else if (op.kind === "delete-match") matches.delete(op.id);
    else profile = op.profile;
  }
  return { profile, matches: [...matches.values()] };
}

/** Validates server rows. Records the app can't read are skipped, not trusted. */
export function rowsToState(
  profileRows: { data: unknown }[],
  matchRows: { data: unknown }[],
  fallbackProfile: PlayerProfile,
) {
  const profile = profileRows.length ? profileSchema.safeParse(profileRows[0].data) : null;
  const matches: Match[] = [];
  let rejected = profile && !profile.success ? 1 : 0;
  for (const row of matchRows) {
    const parsed = matchSchema.safeParse(row.data);
    if (parsed.success) matches.push(parsed.data);
    else rejected += 1;
  }
  return {
    state: { profile: profile?.success ? profile.data : fallbackProfile, matches },
    hasProfile: Boolean(profile?.success),
    rejected,
  };
}

export function realMatches(state: CareerState) {
  return state.matches.filter((match) => !match.isSample);
}

/** Whether a guest career holds anything worth offering to bring into an account. */
export function guestHasRealData(guest: CareerState, blankProfile: PlayerProfile) {
  const customProfile = !guest.profile.isSample && !same(guest.profile, blankProfile);
  return realMatches(guest).length > 0 || customProfile;
}

/**
 * Adds a guest career to an account. Account data always wins: matches already
 * in the account are kept, and the guest profile is used only if the account
 * hasn't set one up yet.
 */
export function mergeCareers(account: CareerState, guest: CareerState, accountHasProfile: boolean) {
  const known = new Set(account.matches.map((match) => match.id));
  const added = realMatches(guest).filter((match) => !known.has(match.id));
  const useGuestProfile = !accountHasProfile && !guest.profile.isSample;
  return {
    state: {
      profile: useGuestProfile ? guest.profile : account.profile,
      matches: [...account.matches, ...added],
    },
    added: added.length,
    usedGuestProfile: useGuestProfile,
  };
}
